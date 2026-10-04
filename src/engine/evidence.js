/**
 * Sahaara AI — Evidence Attribution & Explainability Engine
 *
 * Produces the `evidence_attribution` array required by the §5.1 schema and by
 * CRIT-07 ("verbatim evidence provenance for all safety flags").
 *
 * Every emitted item carries:
 *   - quote          byte-identical substring of the source utterance
 *   - dimension      which indicator it supports
 *   - timestamp      offset from the transcript
 *   - language       script/language metadata (§9)
 *   - signal_id      the lexicon entry that fired
 *
 * An item with no traceable quote is never emitted — a flag without evidence
 * is a defect, not a finding.
 */

import { SIGNALS, matchSignal } from "./lexicon.js";
import { languageMeta } from "./language.js";

/**
 * Split a transcript into utterances if the caller supplied plain text.
 * Recognises "Speaker: text" lines and bare sentences with optional [mm:ss].
 *
 * @param {string} verbatim
 * @returns {Array<{text:string,timestamp:string,speaker:string}>}
 */
export function tokeniseTranscript(verbatim) {
  if (!verbatim) return [];
  const out = [];
  const lines = verbatim.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const stamp = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/);
    const ts = stamp ? stamp[1] : null;
    const rest = stamp ? stamp[2] : line;

    const speakerMatch = rest.match(/^([A-Z][A-Za-z .'-]{0,40}|Interviewer|Complainant|Officer|Caller)\s*:\s*(.+)$/);
    if (speakerMatch) {
      out.push({ timestamp: ts || nextStamp(out), speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim() });
      continue;
    }
    // Sentence-split plain prose.
    for (const sentence of rest.split(/(?<=[.!?।])\s+/).filter(Boolean)) {
      out.push({ timestamp: ts || nextStamp(out), speaker: "complainant", text: sentence.trim() });
    }
  }
  return out;
}

function nextStamp(list) {
  const seconds = list.length * 8;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Build the evidence attribution array.
 *
 * @param {Array} utterances         [{ text, timestamp, speaker }]
 * @param {Object} opts
 * @param {string[]} opts.dimensions Only emit evidence for these dimensions.
 * @param {boolean} [opts.includeNegated] Also emit protective/negated evidence.
 * @param {string[]|null} [opts.languageHint]
 * @returns {Array<Object>}
 */
export function buildEvidence(utterances, { dimensions = [], includeNegated = true, languageHint = null } = {}) {
  const wanted = new Set(dimensions);
  const items = [];
  const seen = new Set();

  for (const u of utterances) {
    if (!u.text) continue;

    for (const signal of SIGNALS) {
      if (wanted.size && !wanted.has(signal.dimension)) continue;
      const res = matchSignal(signal, u.text);
      if (!res.matched) continue;
      // Protective signals (negative weight) are only emitted on request.
      if (res.negated && !includeNegated) continue;

      const key = `${u.timestamp}|${signal.id}|${signal.dimension}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const lang = languageMeta(u.text, languageHint, u.timestamp);

      items.push({
        quote: u.text, // byte-identical — never normalised, never translated
        verbatim: u.text,
        dimension: signal.dimension,
        signal_id: signal.id,
        timestamp_offset: u.timestamp,
        timestamp: u.timestamp,
        language: lang.code_switched
          ? `${lang.language}+${lang.language_secondary}`
          : lang.language,
        speaker: u.speaker || "complainant",
        role: res.negated ? "negated" : signal.weight < 0 ? "protective" : "incriminating",
        weight: signal.weight,
        matched_pattern: res.matchedPattern,
        language_detail: {
          primary: lang.language,
          secondary: lang.language_secondary,
          code_switched: lang.code_switched,
          gloss: lang.gloss,
        },
      });
    }
  }

  // Highest-impact first; stable within equal weight.
  items.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return items;
}

/**
 * Keep only the strongest N items per dimension so the panel stays legible
 * without dropping a safety-critical citation.
 *
 * @param {Array} evidence
 * @param {number} perDimension
 */
export function trimEvidence(evidence, perDimension = 4) {
  const counts = new Map();
  return evidence.filter((e) => {
    const n = counts.get(e.dimension) || 0;
    if (n >= perDimension) return false;
    counts.set(e.dimension, n + 1);
    return true;
  });
}

/**
 * CRIT-07: every safety flag must resolve to at least one quoted span.
 *
 * @param {Array} evidence
 * @param {Array<string>} flaggedDimensions
 * @returns {{ok:boolean, missing:string[]}}
 */
export function verifyEvidenceProvenance(evidence, flaggedDimensions) {
  const missing = flaggedDimensions.filter(
    (d) => !evidence.some((e) => e.dimension === d && e.quote && e.quote.length > 0)
  );
  return { ok: missing.length === 0, missing };
}

/**
 * Assert verbatim integrity (CRIT-09) against the original source strings.
 *
 * @param {Array} evidence
 * @param {string[]} sourceTexts
 */
export function assertEvidenceVerbatim(evidence, sourceTexts) {
  const corpus = sourceTexts.join("\n");
  for (const e of evidence) {
    if (!corpus.includes(e.quote)) {
      throw new Error(
        `EVIDENCE_INTEGRITY_VIOLATION: quote not found verbatim in source transcript — "${e.quote.slice(0, 60)}..." (CRIT-09)`
      );
    }
  }
}
