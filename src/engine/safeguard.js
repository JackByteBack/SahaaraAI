/**
 * Sahaara AI — Non-Diagnostic Safeguard
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CRIT-02 (MANDATORY): absolute prohibition of clinical / psychiatric
 * diagnoses. The platform is a decision-support tool, never a diagnostic one.
 *
 * Hipgrave et al. (2025) identify unauthorised psychiatric diagnosis as a
 * primary clinician concern with generative AI in mental healthcare; Ridings
 * et al. (2026) make non-maleficence a core TRUST pillar. This module is the
 * mechanical enforcement of both.
 *
 * Two layers:
 *   1. PROHIBITED_TERMS  — scrubbed from every generated string (defence in depth).
 *   2. assertNonDiagnostic() — throws if a diagnosis reached an output payload.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * DSM-5 / ICD-11 and colloquial clinical labels that must never appear as an
 * output of this system. Matched case-insensitively as whole words.
 */
export const PROHIBITED_TERMS = [
  // Diagnostic disorders
  "PTSD", "post-traumatic stress disorder", "post traumatic stress disorder",
  "depression", "major depressive disorder", "clinical depression", "mdd",
  "bipolar", "bipolar disorder", "schizophrenia", "schizoaffective",
  "borderline", "bpd", "borderline personality disorder",
  "personality disorder", "antisocial personality", "narcissistic personality",
  "anxiety disorder", "generalized anxiety disorder", "gad", "panic disorder",
  "obsessive compulsive", "ocd", "dissociative identity disorder",
  "adjustment disorder", "acute stress disorder", "complex ptsd", "c-ptsd",
  "dysthymia", "persistent depressive disorder", "psychosis", "psychotic",
  "dissociative disorder", "somatoform", "histrionic", "dependent personality",
  "agoraphobia", "social anxiety disorder", "specific phobia",
  "anorexia", "bulimia", "binge eating disorder", "body dysmorphic",
  "attention deficit", "adhd", "autism spectrum disorder", "asd",
  "conduct disorder", "oppositional defiant", "reactive attachment",
  "substance use disorder", "addiction diagnosis", "dependence syndrome",
  "intellectual disability", "mental retardation",
  // Construct-as-diagnosis phrasings
  "diagnosis of", "diagnosed with", "diagnostic label", "dsm-5", "dsm 5", "icd-11", "icd 11",
  "patient presents with", "clinical diagnosis", "psychiatric diagnosis",
  "comorbid with", "comorbidity", "prodromal", "pathological",
  "symptom cluster", "meets criteria for", "axis i", "axis ii",
];

/**
 * Colloquial risk phrasings that imply the system has clinically assessed the
 * complainant. Replace with operational language.
 */
export const PROHIBITED_PHRASES = [
  { bad: /\b(suffers? from|has|have)\s+(depression|anxiety|ptsd|bpd|bipolar)\b/i,
    fix: "reports indicators consistent with operational distress" },
  { bad: /\bclinically\b/i, fix: "operationally" },
  { bad: /\bsymptom(s)?\b/i, fix: "indicator(s)" },
  { bad: /\bpatient(s)?\b/i, fix: "complainant(s)" },
  { bad: /\btreatment plan\b/i, fix: "support plan" },
];

const TERM_RE = new RegExp(
  `\\b(?:${PROHIBITED_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i"
);

/**
 * Diagnostic acronyms that collide with ordinary English when matched
 * case-insensitively — "did" is the everyday past tense of "do" and would
 * otherwise flag every verbatim quote that contains it, turning CRIT-02 into
 * a denial-of-service on real transcripts. Matched in uppercase only; the
 * full form ("dissociative identity disorder") stays in PROHIBITED_TERMS.
 */
export const CASE_SENSITIVE_ACRONYMS = ["DID"];

const ACRONYM_RE = new RegExp(
  `\\b(?:${CASE_SENSITIVE_ACRONYMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`
);

/**
 * Recursively scan any generated value for prohibited diagnostic language.
 *
 * @param {*} value
 * @param {string} [path]
 * @returns {Array<{path:string, term:string}>}
 */
export function findDiagnosticLanguage(value, path = "$") {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === "string") {
      const m = TERM_RE.exec(v) || ACRONYM_RE.exec(v);
      if (m) hits.push({ path: p, term: m[0] });
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    }
  };
  walk(value, path);
  return hits;
}

/**
 * CRIT-02 hard gate. Throws if a diagnosis reached a payload.
 * Call immediately before returning any assessment to a caller.
 *
 * @param {*} payload
 * @throws {Error} DIAGNOSTIC_OUTPUT_VIOLATION
 */
export function assertNonDiagnostic(payload) {
  const hits = findDiagnosticLanguage(payload);
  if (hits.length) {
    throw new Error(
      `DIAGNOSTIC_OUTPUT_VIOLATION (CRIT-02): prohibited clinical language in output — ` +
      hits.map((h) => `${h.path}="${h.term}"`).join(", ")
    );
  }
  return true;
}

/**
 * Best-effort scrub for free-text the system itself composes (rationales,
 * panel copy). Prefer constructing text without these terms in the first place.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubDiagnosticLanguage(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const { bad, fix } of PROHIBITED_PHRASES) out = out.replace(bad, fix);
  const m = TERM_RE.exec(out);
  if (m) {
    out = out.replace(TERM_RE, "[redacted: clinical label]");
  }
  return out;
}

/**
 * The non-diagnostic notice appended to every AI-generated payload.
 */
export const NON_DIAGNOSTIC_NOTICE =
  "Sahaara AI is non-diagnostic. It reports operational distress, safety and vulnerability " +
  "indicators only. It does not produce psychiatric or medical diagnoses of any kind. " +
  "A human reviewer is the final decision-maker.";

/**
 * Behavioural flags emitted in place of a diagnosis (TC-05).
 * These describe observable acts, never internal clinical states.
 */
export const BEHAVIOURAL_FLAG_LIBRARY = {
  LETHAL_MEANS_PROXIMITY: {
    flag: "LETHAL_MEANS_PROXIMITY", severity: "CRITICAL",
    description: "Lethal means reported as immediately accessible to the complainant.",
  },
  PREPARATORY_FAREWELL_BEHAVIOUR: {
    flag: "PREPARATORY_FAREWELL_BEHAVIOUR", severity: "HIGH",
    description: "Farewell or preparatory action reported (notes, giving possessions away).",
  },
  HOPELESSNESS_PERVASIVE: {
    flag: "HOPELESSNESS_PERVASIVE", severity: "HIGH",
    description: "Pervasive statement of no forward path or no way out, in the complainant's own words.",
  },
  EXPLICIT_IMMINENT_DANGER: {
    flag: "EXPLICIT_IMMINENT_DANGER", severity: "CRITICAL",
    description: "Present-moment physical danger reported with specific, verifiable detail.",
  },
  ESCALATING_CONTACT_PATTERN: {
    flag: "ESCALATING_CONTACT_PATTERN", severity: "HIGH",
    description: "Repeated or escalating unsolicited contact, including attempts to avoid identification.",
  },
  EXTERNAL_INTERFERENCE_SIGNAL: {
    flag: "EXTERNAL_INTERFERENCE_SIGNAL", severity: "MEDIUM",
    description: "Unconfirmed signal consistent with third-party presence or influence during intake.",
  },
  CONTRADICTORY_SAFETY_STATEMENTS: {
    flag: "CONTRADICTORY_SAFETY_STATEMENTS", severity: "HIGH",
    description: "Two or more mutually inconsistent statements about safety in the same record.",
  },
};
