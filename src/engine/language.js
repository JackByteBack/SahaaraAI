/**
 * Sahaara AI — Multilingual & Indic Code-Switching Engine
 *
 * Implements §9 of the specification:
 *   1. Phonetic & Morphological Tokenizer — identifies Devanagari script tokens
 *      alongside Latin-script (English / Hinglish / Marlish) tokens.
 *   2. Dual-Channel Glossing — generates an interpretation while PRESERVING the
 *      verbatim text for court evidentiary admissibility.
 *   3. Idiomatic Risk Dictionary — regional threat idioms that machine
 *      translation typically sanitises or misinterprets.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NON-NEGOTIABLE INVARIANT (CRIT-09)
 * The `verbatim` field of every evidence item is byte-identical to the source
 * utterance. The gloss is ADDITIVE metadata and can never replace it.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Unicode script ranges. */
const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[A-Za-z]/;
const DEVANAGARI_WORD = /[\u0900-\u097F]+/g;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** BCP-47 tags used in `language` metadata. */
export const LANG = { MARATHI: "mr", HINDI: "hi", ENGLISH: "en", ROMANISED: "hi-Latn" };

/**
 * Idiomatic risk dictionary.
 *
 * `risk` is one of THREAT | INTIMIDATION | FEAR | HELPSEEKING | DISCLOSURE.
 * `sanitised` documents how naive MT commonly flattens the phrase — this is the
 * reason the dictionary exists (§9.2 step 3).
 */
export const IDIOMS = [
  { native: "बघून घेईन", roman: "baghūn gheīn", gloss: "I will deal with you / I will ruin you",
    risk: "THREAT", strength: 0.6, sanitised: 'often rendered as "I will see" — losing the threat entirely' },
  { native: "मला खूप भीती वाटते", roman: "malā khūp bhītī vāṭate", gloss: "I feel very scared",
    risk: "FEAR", strength: 0.35, sanitised: null },
  { native: "मला सहन होत नाहीये", roman: "malā sahan hoto nāhīye", gloss: "I can't bear this anymore",
    risk: "HELPSEEKING", strength: 0.4, sanitised: null },
  { native: "तो जिवान मारीन", roman: "to jivān mārīn", gloss: "He will kill me (lit. 'he will take my life')",
    risk: "THREAT", strength: 0.75, sanitised: null },
  { native: "मला घरच्यांना सांगायचं नाही", roman: "malā gharcyānnā sāngāyaca nāhī", gloss: "I don't want to tell my family",
    risk: "DISCLOSURE", strength: 0.3, sanitised: null },
  { native: "धावत होते आणि तो मागे आला", roman: "dhāvat hote āṇi to māge ālā", gloss: "I was running and he came after me",
    risk: "THREAT", strength: 0.5, sanitised: null },
  { native: "तो पुन्हा पोलिस स्टेशनला येईल", roman: "to punhā polis stēśanalā yeīl", gloss: "He will come to the police station again",
    risk: "INTIMIDATION", strength: 0.4, sanitised: null },
  { native: "घाबरतो", roman: "ghābarato", gloss: "I am afraid", risk: "FEAR", strength: 0.3, sanitised: null },
  { native: "मला मदत हवी आहे", roman: "malā madat havī āhe", gloss: "I need help", risk: "HELPSEEKING", strength: 0.4, sanitised: null },
];

/**
 * Detect script composition and code-switching in a verbatim string.
 *
 * @param {string} text
 * @returns {{primary:string, primaryPct:number, secondary:string|null, secondaryPct:number,
 *            codeSwitched:boolean, switchCount:number, spans:Array<{lang:string,text:string,start:number,end:number}>,
 *            devanagariPct:number, latinPct:number}}
 */
export function analyseLanguage(text) {
  const words = [];
  let m;
  DEVANAGARI_WORD.lastIndex = 0;
  while ((m = DEVANAGARI_WORD.exec(text)) !== null) words.push({ lang: LANG.MARATHI, text: m[0], start: m.index, end: m.index + m[0].length });
  LATIN_WORD.lastIndex = 0;
  while ((m = LATIN_WORD.exec(text)) !== null) words.push({ lang: LANG.ENGLISH, text: m[0], start: m.index, end: m.index + m[0].length });

  words.sort((a, b) => a.start - b.start);

  const devCount = words.filter((w) => w.lang === LANG.MARATHI).length;
  const latCount = words.length - devCount;
  const total = words.length || 1;
  const devPct = devCount / total;
  const latPct = latCount / total;

  const primary = devPct >= latPct ? LANG.MARATHI : LANG.ENGLISH;
  const primaryPct = Math.round(Math.max(devPct, latPct) * 100);
  const secondary = devPct >= latPct ? (latCount ? LANG.ENGLISH : null) : (devCount ? LANG.MARATHI : null);
  const secondaryPct = secondary ? Math.round(Math.min(devPct, latPct) * 100) : 0;

  // Count script transitions in document order.
  let switchCount = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i].lang !== words[i - 1].lang) switchCount++;
  }

  return {
    primary,
    primaryPct,
    secondary,
    secondaryPct,
    codeSwitched: switchCount > 0,
    switchCount,
    spans: words,
    devanagariPct: Math.round(devPct * 100),
    latinPct: Math.round(latPct * 100),
  };
}

/**
 * Resolve idioms present in the text.
 *
 * @param {string} text
 * @returns {Array<{native:string, roman:string, gloss:string, risk:string, strength:number, sanitised:string|null, index:number}>}
 */
export function findIdioms(text) {
  const out = [];
  for (const idiom of IDIOMS) {
    const i = text.indexOf(idiom.native);
    if (i >= 0) out.push({ ...idiom, index: i });
    else if (idiom.roman) {
      const r = text.toLowerCase().indexOf(idiom.roman.toLowerCase());
      if (r >= 0) out.push({ ...idiom, index: r });
    }
  }
  return out;
}

/**
 * Produce language metadata + gloss for a verbatim utterance.
 *
 * @param {string} verbatim  MUST be preserved untouched.
 * @param {string[]|null} languageHint
 * @param {string} timestamp  Source timestamp for evidence attribution.
 */
export function languageMeta(verbatim, languageHint = null, timestamp = "00:00") {
  const analysis = analyseLanguage(verbatim);
  const idioms = findIdioms(verbatim);

  const glosses = idioms.map((i) => ({ at: timestamp, idiom: i.native, gloss: i.gloss, risk: i.risk }));

  return {
    language: analysis.primary,
    language_secondary: analysis.secondary,
    language_pct: analysis.primaryPct,
    language_pct_secondary: analysis.secondaryPct,
    code_switched: analysis.codeSwitched,
    script_switch_count: analysis.switchCount,
    devanagari_pct: analysis.devanagariPct,
    latin_pct: analysis.latinPct,
    language_hint: languageHint,
    detected_languages: [...new Set([analysis.primary, analysis.secondary].filter(Boolean))],
    /** Interpretation only — NEVER a replacement for `verbatim`. */
    gloss: glosses.length ? glosses : null,
    idioms_detected: idioms.map((i) => ({
      native: i.native, roman: i.roman, gloss: i.gloss,
      risk: i.risk, strength: i.strength, mt_hazard: i.sanitised,
    })),
    preservation_notice:
      "Verbatim source retained byte-identical. Gloss is additive interpretation for the reviewer and is not evidentiary text.",
  };
}

/**
 * CRIT-09 guard: assert the source text was not mutated by processing.
 * Throws loudly rather than silently continuing with corrupt evidence.
 *
 * @param {string} original
 * @param {string} stored
 */
export function assertVerbatimUnchanged(original, stored) {
  if (original !== stored) {
    throw new Error(
      "EVIDENCE_INTEGRITY_VIOLATION: verbatim evidence was modified during processing (CRIT-09)."
    );
  }
}
