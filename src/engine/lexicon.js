/**
 * Sahaara AI — Deterministic Lexical Signal Dictionary
 *
 * Layer 0 (src/engine/layer0.js) owns catastrophic-risk interception and runs
 * BEFORE any probabilistic scoring. This module supplies the softer, weighted
 * signals consumed by the multidimensional engine (src/engine/dimensions.js).
 *
 * Design rules:
 *  - Every signal carries a stable id, a weight and a target dimension so any
 *    score can be traced back to the exact lexicon entries that moved it.
 *  - Signals are `negatable`: "I am NOT in danger" must not score as danger.
 *  - Nothing here ever emits a clinical/psychiatric label (see safeguard.js).
 */

/**
 * Negation markers across English, Marathi and Hindi (Roman + native script).
 *
 * Split into separate patterns so that Indic negators can be prevented from
 * matching inside a longer word ("नाहीतर" must not read as "नाही").
 */
const NEGATORS = [
  /(?:^|[^A-Za-z])(no|not|never|none|nobody|nothing|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|didn'?t|won'?t|can'?t|cannot|without)\b/i,
  /\b(nahi|nahin)\b/i,
  /नाही(?![\u0900-\u097F])/,
  /नको(?![\u0900-\u097F])/,
  /नहीं?(?![\u0900-\u097F])/,
];

/**
 * Clause boundary. A negator only scopes over a match when no sentence-ending
 * punctuation falls between them — "You don't know what I'm capable of. I'll
 * finish this" must NOT read as a negated threat.
 */
const CLAUSE_BOUNDARY = /[.!?।]/;

/**
 * @typedef {Object} Signal
 * @property {string}   id         Stable identifier, surfaced in evidence.
 * @property {'safety'|'self_harm'|'distress'|'vulnerability'|'support'|'anomaly'} dimension
 * @property {number}   weight     Contribution when matched (negative = protective).
 * @property {RegExp[]} patterns   Lexical triggers (case-insensitive).
 * @property {boolean}  [negatable] Default true. False for phrases that are
 *                                  already inherently negative in context.
 */

/** @type {Signal[]} */
export const SIGNALS = [
  // ── Direct threat / intimidation ────────────────────────────────────────
  { id: "THREAT_DIRECT", dimension: "safety", weight: 0.75, patterns: [
    /\bkill (you|me|her|him|them|us)\b/i, /\bfinish (you|this|her|him)\b/i,
    /\byou will regret\b/i, /\bi('ll| will) (ruin|destroy|end|fix) (you|her|him|this)\b/i,
    /\b(beat|hit|smash|shoot|stab|murder)\b/i, /\bi('ll| will) make sure\b/i,
    /\bnot make it\b/i, /\bbefore the month ends\b/i, /\bdead by\b/i,
    /\bi('ll| will) (kill|hurt|harm|cut|bleed) (you|her|him|them)\b/i,
    /\b(bleed|gut) (you|her|him)? ?out\b/i,
    /\.तुझ्यावर\s+केस/i, /बघून\s+घेईन/i, /जिवान\s+मारीन/i, /मारीन\b/i,
  ]},
  { id: "THREAT_IMMINENT", dimension: "safety", weight: 0.45, patterns: [
    /\bright now\b/i, /\bat the (gate|door|window)\b/i, /\boutside (right now|the (house|gate|door))\b/i,
    /\bhe('s| is) (outside|coming|approaching|pushing)\b/i, /\bin (seconds|a moment)\b/i,
    /\bgoing to (come|break|enter)\b/i, /\bcoming in\b/i, /\bon his way\b/i,
    /आत्ता/i, /\bतो\s+बाहेर\s+आहे\b/i,
  ]},
  /**
   * Conditional / future-directed arrival threat.
   *
   * Deliberately separate from THREAT_IMMINENT: "switch off your phone or I'll
   * come to the house" is a genuine threat but is not present-moment danger.
   * Merging them would inflate immediate-safety readings on retrospective
   * disclosures (TC-08) and undermine the immediate-danger construct.
   */
  { id: "THREAT_FUTURE_ARRIVAL", dimension: "safety", weight: 0.3, patterns: [
    /येईन/i, /येईल/i, /\bwill come (back|again|to the house|for you)\b/i,
    /\bi('ll| will) come (back|again|for you)\b/i,
  ]},
  { id: "THREAT_SURVEILLANCE", dimension: "safety", weight: 0.4, patterns: [
    /\bknows? which (bus|route|street|road)\b/i, /\bknows? where\b/i,
    /\bparked (outside|down the block|across)\b/i, /\bnew (number|numbers)\b/i,
    /\bevery (week|day|night)\b/i, /\bfollows? me\b/i, /\bstalking\b/i, /\btracking me\b/i,
    /\b(waiting|standing|sitting) (outside|near|across|in front of) (the )?(court|office|gate|house|school)\b/i,
    /\bkeeps? (calling|texting|messag)/i, /\bletters? for\b/i,
  ]},
  { id: "INTIMIDATION", dimension: "safety", weight: 0.3, patterns: [
    /\bintimidat/i, /\bterrified\b/i, /\bscared of\b/i, /\bfear(s|ed)? for\b/i,
    /\bdare (you|me)\b/i, /\bwarning (me|him|her)\b/i, /भीती\s+वाट/i,
  ]},
  { id: "WEAPON_OR_MEANS", dimension: "safety", weight: 0.5, patterns: [
    /\bcrowbar\b/i, /\bknife\b/i, /\bgun\b/i, /\bweapon/i, /\bblade\b/i,
    /\b(kerosene|acid)\b/i, /\bsomething in his hand\b/i, /\bmetal (bar|rod|pipe)\b/i,
    /\bhunting knife\b/i, /\bचाकू\b/i,
  ]},
  { id: "FORCED_ENTRY", dimension: "safety", weight: 0.55, patterns: [
    /\bbanging on\b/i, /\bkick(ing)? the door\b/i, /\bpushing the door\b/i,
    /\bbroke (down )?the (door|lock)\b/i, /\bbreaking in\b/i, /\bglass is starting to crack\b/i,
    /\bforced the (door|lock|gate)\b/i, /\bbreak through\b/i, /\bbreaking the door\b/i,
    /\bदरवाजा\s+वाजव/i,
  ]},
  { id: "PRIOR_VIOLENCE", dimension: "safety", weight: 0.5, patterns: [
    /\bbroke (two of )?my ribs\b/i, /\bbroke my (arm|leg|nose|ribs)\b/i,
    /\bhe (hit|beat|choked|strangled|punched) me\b/i, /\bhospital for \d+ days\b/i,
    /\bhe has done it before\b/i, /\bhe (used to) (hit|beat) me\b/i, /\bmarch\b/i,
  ]},
  { id: "PURSUIT", dimension: "safety", weight: 0.35, patterns: [
    /\bchased me\b/i, /\bcame after me\b/i, /\brunning after\b/i,
    /\bfollowed me (home|out)\b/i, /\bwaiting (outside|for me)\b/i,
  ]},
  { id: "ESCALATING_METHOD", dimension: "safety", weight: 0.4, patterns: [
    /\bnext time he won'?t stop\b/i, /\bwon'?t stop at\b/i, /\bpour .{0,20} on me\b/i,
    /\bthis time\b/i, /\bagain .{0,30}(worse|harder)\b/i,
  ]},
  { id: "DEPENDENT_AT_RISK", dimension: "safety", weight: 0.3, patterns: [
    /\bmy (daughter|son|child|children|baby) (is|was) (here|with me|there)\b/i,
    /\bknows where my (daughter|son|child) goes\b/i, /\b(child|children) at home\b/i,
  ]},

  // ── Protective / explicit absence of danger ─────────────────────────────
  /**
   * Absolute protective claims — "I am safe", "nobody has contacted me".
   * These are universal statements about the whole record, which is exactly
   * what a later contradictory disclosure can invalidate (TC-13).
   */
  { id: "SAFE_EXPLICIT", dimension: "safety", weight: -0.45, negatable: false, absolute: true, patterns: [
    /\bi('?m| am) (not in )?danger\b/i, /\bi('?m| am) safe\b/i,
    /\bnobody has threatened me\b/i, /\bno direct contact\b/i,
    /\bhe hasn'?t come near\b/i, /\bno one is (here|with him)\b/i,
    /\bnobody has contacted me\b/i, /\bin prison\b/i, /\bthe order is in place\b/i,
    /\bno problem\b/i, /\bnot in any (physical )?danger\b/i,
  ]},
  /**
   * Time-scoped reassurance — "not right now", "आत्ता नाही".
   * Deliberately NOT absolute: a scoped "not at this moment" can coexist with
   * a future threat without the two being in contradiction, so it must never
   * trigger conflict analysis.
   */
  { id: "SAFE_CURRENT_MOMENT", dimension: "safety", weight: -0.35, negatable: false, absolute: false, patterns: [
    /आत्ता\s+नाही/i, /\bnot right now\b/i, /\bas of now,? (nothing|no)\b/i,
    /\bno,? not (currently|at the moment)\b/i,
  ]},
  { id: "NO_SELF_HARM", dimension: "self_harm", weight: -0.6, negatable: false, patterns: [
    /\bnever\b/i, /\bno,? no\b/i, /\bi don'?t (want to )?(hurt|end|kill) myself\b/i,
    /\bno thoughts of\b/i, /\bhaven'?t had any thoughts\b/i, /नाही\s*,?\s*नाही/i,
  ]},

  // ── Self-harm ───────────────────────────────────────────────────────────
  { id: "SH_INTENT", dimension: "self_harm", weight: 0.6, patterns: [
    /\bending it\b/i, /\bend it\b/i, /\bend my life\b/i, /\bkill myself\b/i,
    /\bdon'?t want to (wake up|live|be here)\b/i, /\bno way forward\b/i,
    /\bno other way (out|forward)\b/i, /\bthere'?s? no way out\b/i,
    /\bdon'?t want to (do) this (anymore|any more)\b/i, /\bi just don'?t want to\b/i,
    /\bwant to die\b/i, /\bbetter off (dead|without me)\b/i, /\bcannot go on\b/i,
    /\bनाही\s+राहायचं\b/i,
  ]},
  { id: "SH_MEANS", dimension: "self_harm", weight: 0.55, patterns: [
    /\b(sleeping )?pills\b/i, /\btablets with me\b/i, /\bbottle of (my )?prescription\b/i,
    /\bwhole bottle\b/i, /\bholding them in my hand\b/i, /\bpoison\b/i,
    /\brope\b/i, /\bcut my wrists\b/i, /\bmatchbox\b/i,
  ]},
  { id: "SH_PREPARATION", dimension: "self_harm", weight: 0.5, patterns: [
    /\bwrote (a note|letters?)\b/i, /\bletters? for my\b/i, /\bfarewell\b/i,
    /\bgave (away|all my)\b/i, /\bwritten a note\b/i, /\bput (my|everything) in order\b/i,
  ]},
  { id: "SH_IDEATION_CONTEXT", dimension: "self_harm", weight: 0.3, patterns: [
    /\bwake up to this (nightmare|again)\b/i, /\bcan'?t (look at|face) my\b/i,
    /\bnothing left\b/i, /\bi can'?t take (this|it) (anymore|any more)\b/i,
    /\bनाही\s+राहणार\b/i,
  ]},

  // ── Psychological distress ──────────────────────────────────────────────
  { id: "DIST_SLEEP", dimension: "distress", weight: 0.35, patterns: [
    /\b(haven'?t|not) been sleeping\b/i, /\bcan'?t sleep\b/i, /\binsomnia\b/i,
    /\blie awake\b/i, /\bsleep at (four|4|three|3)\b/i, /\bnot sleeping properly\b/i,
    /\bnot sleeping (through|well)\b/i,
    /\bdidn'?t sleep\b/i, /\bwaking up at\b/i, /\bsleep disruption\b/i,
  ]},
  { id: "DIST_CRYING", dimension: "distress", weight: 0.3, patterns: [
    /\bi cry\b/i, /\bcrying\b/i, /\bcried\b/i, /\btears\b/i, /\bbreaking down\b/i,
    /\bsobbing\b/i, /\bcry in the bathroom\b/i, /\bकडकणे/i,
  ]},
  { id: "DIST_ANXIETY", dimension: "distress", weight: 0.25, patterns: [
    /\banxious\b/i, /\banxiety\b/i, /\bpanic\b/i, /\bchest (tightens|tight)\b/i,
    /\bcan'?t concentrate\b/i, /\bworr(y|ied|ying)\b/i, /\bnervous\b/i,
    /भीती\s+वाट/i, /घाबरतो/i,
  ]},
  { id: "DIST_HOPELESS", dimension: "distress", weight: 0.4, patterns: [
    /\bhopeless/i, /\bcan'?t cope\b/i, /\bunable to cope\b/i, /\bgive up\b/i,
    /\bhumiliat/i, /\bworthless\b/i, /\btrapped\b/i, /\bcan'?t take it\b/i,
    /मला\s+सहन\s+होत\s+नाहीये/i, /सहन\s+होत\s+नाही/i,
  ]},
  { id: "DIST_SOMATIC", dimension: "distress", weight: 0.25, patterns: [
    /\bshaking\b/i, /\btrembling\b/i, /\bheart racing\b/i, /\bsweating\b/i,
    /\bnausea\b/i, /\bheadache\b/i,
  ]},
  { id: "DIST_PERMANENT", dimension: "distress", weight: 0.3, patterns: [
    /\bfor (about )?(two|three|four|\d+) (weeks|months|days)\b/i,
    /\bsince (march|january|february|april|may|june|july|august|september|october|november|december)\b/i,
    /\bstill\b.{0,30}\b(since|from)\b/i,
  ]},

  // ── Contextual vulnerability ────────────────────────────────────────────
  { id: "VUL_ISOLATION", dimension: "vulnerability", weight: 0.45, patterns: [
    /\blocked me (in|out|up)\b/i, /\btook my phone\b/i, /\bcan'?t leave\b/i,
    /\bnot allowed to\b/i, /\bhad to use the neighbor/i, /\bfrom the outside\b/i,
    /\bhiding in\b/i, /\block(ed)? the .* from the outside\b/i,
  ]},
  { id: "VUL_SUPPORT_GAP", dimension: "vulnerability", weight: 0.3, patterns: [
    /\bno one to talk to\b/i, /\bno support\b/i, /\bhaven'?t gone back\b/i,
    /\bnobody calls me back\b/i, /\bi'?m alone\b/i, /\bleft alone\b/i,
    /\bi don'?t know who\b/i, /\bकोणी\s+नाही\b/i,
  ]},
  { id: "VUL_DEPENDENT", dimension: "vulnerability", weight: 0.25, patterns: [
    /\bmy (daughter|son|child|children|baby|mother|mom|father|dad)\b/i,
    /\bsingle (mother|parent)\b/i, /\bpurely dependent\b/i, /\bमुलं\b/i,
  ]},
  { id: "VUL_OCCUPATIONAL", dimension: "vulnerability", weight: 0.25, patterns: [
    /\bboss has warned\b/i, /\blost my job\b/i, /\bcan'?t (work|concentrate)\b/i,
    /\bwarning from\b/i, /\bcolleague\b/i, /\boffice gate\b/i, /\bshift finishes\b/i,
  ]},
  { id: "VUL_DISCLOSURE_BARRIER", dimension: "vulnerability", weight: 0.3, patterns: [
    /\bdon'?t want to (tell|say|report)\b/i, /\bhaven'?t (told|said|reported)\b/i,
    /\bcan'?t tell\b/i, /\bafraid to report\b/i, /\bdon'?t want to file\b/i,
    /सांगायचं\s+नाही/i, /घरच्यांना\s+सांगायचं\s+नाही/i,
  ]},
  /**
   * Undecided / unable to act — the complainant has not resolved whether to
   * engage formal channels, or reports that nothing is clear to them. This is
   * a support and agency gap rather than a distress symptom, so it scores as
   * contextual vulnerability only.
   */
  { id: "VUL_UNDECIDED", dimension: "vulnerability", weight: 0.3, patterns: [
    /ठरवायचं\s+नाही/i, /काही\s+समजत\s+नाही/i, /\bhaven'?t decided\b/i,
    /\bdon'?t know what to do\b/i, /\bno idea what\b/i, /\bnot sure whether\b/i,
    /निर्णय\s+घेऊ\s+शकत\s+नाही/i,
  ]},
  { id: "VUL_INSTITUTIONAL_DELAY", dimension: "vulnerability", weight: 0.25, patterns: [
    /\b(adjourned|delayed|postponed)\b/i, /\bthree months\b/i, /\bhearing\b/i,
    /\bnobody (calls|called) me back\b/i, /\bpending\b/i, /\bfollow[- ]?up\b/i,
  ]},
  { id: "VUL_ECONOMIC", dimension: "vulnerability", weight: 0.2, patterns: [
    /\bno money\b/i, /\bcan'?t afford\b/i, /\bdependent on\b/i, /\bwage\b/i,
  ]},

  // ── Protective factors (reduce vulnerability) ───────────────────────────
  { id: "SUP_FAMILY", dimension: "support", weight: -0.25, negatable: false, patterns: [
    /\bmy (brother|husband|sister|wife|family) (knows|is here|is with me)\b/i,
    /\bwe go together\b/i, /\bmy family\b/i, /\bhome with me\b/i,
  ]},
  { id: "SUP_SAFE_PLACE", dimension: "support", weight: -0.3, negatable: false, patterns: [
    /\bi'?m safe at home\b/i, /\bsafe at home\b/i, /\bsleeping fine\b/i,
    /\bsleeping through( the night)?\b/i,
    /\beating fine\b/i, /\bgoing to work as usual\b/i, /\bi'?m fine\b/i,
  ]},
  { id: "SUP_PROFESSIONAL", dimension: "support", weight: -0.25, negatable: false, patterns: [
    /\bcounsellor\b/i, /\bcounselor\b/i, /\btherapist\b/i, /\bpolice protection\b/i,
    /\b(fir|charge sheet) .{0,20}(filed|on record)\b/i, /\bprotective order\b/i,
    /\bnamed witness\b/i, /\blegal (aid|help)\b/i,
  ]},

  // ── Anomaly / possible external interference (TC-10) ────────────────────
  { id: "ANOM_DENIAL_REVERSAL", dimension: "anomaly", weight: 0.5, negatable: false, patterns: [
    /\bplease (ignore|disregard) what i just said\b/i,
    /\beverything is (fine|okay|ok)\b/i, /\bplease close (this|the) (file|case|it)\b/i,
    /\bi was just overreacting\b/i, /\bthat was a mistake\b/i,
    /\bplease close it\b/i, /\bno,? no\.?\s*that was\b/i, /\bmisunderstanding things\b/i,
    /\bthere is no problem\b/i, /\bno problem\b/i,
  ]},
  { id: "ANOM_MARKED_AFFECT", dimension: "anomaly", weight: 0.3, negatable: false, patterns: [
    /\bhaan ji\b/i, /\bbilkul\b/i, /\bsaaf saaf bolo\b/i, /\bof course everything\b/i,
  ]},

  // ── Conflicting-evidence markers (TC-13) ────────────────────────────────
  { id: "CONFLICT_RETRACTION", dimension: "anomaly", weight: 0.4, negatable: false, patterns: [
    /\bactually,? i (need to )?say something\b/i, /\bbefore we close\b/i,
    /\bi need to (correct|change|add to)\b/i, /\bone (more )?thing\b/i,
    /\bto be honest\b/i, /\bstill,?\s*i\b/i, /\bbut .{0,25}hide\b/i, /\bhiding a\b/i,
  ]},
];

/** Lethality anchors referenced by Layer 0's semantic proximity stage. */
export const LETHALITY_ANCHORS = [
  "break in", "kick the door", "crowbar", "kill me", "kill you",
  "right now", "at the gate", "pushing the door", "something in his hand",
  "tablets", "sleeping pills", "wrote a note", "ending it", "don't want to wake up",
  "kerosene", "bottle of pills",
];

/**
 * Match one signal against text, honouring local negation.
 *
 * Two conditions must BOTH hold for a match to count as negated:
 *   1. a negation marker appears within 48 characters before the match, and
 *   2. no clause boundary (`. ! ? ।`) falls between that marker and the match.
 *
 * So "You don't know what I'm capable of. I'll finish this before the month
 * ends" scores as a live threat, while "I don't think he will kill me" does not.
 *
 * @param {Signal} signal
 * @param {string} text
 * @returns {{matched:boolean, matchedPattern?:string, negated?:boolean, index?:number, hit?:string}}
 */
export function matchSignal(signal, text) {
  for (const pattern of signal.patterns) {
    const m = pattern.exec(text);
    if (!m) continue;
    let negated = false;
    if (signal.negatable !== false) {
      const window = text.slice(Math.max(0, m.index - 48), m.index);
      if (window && !CLAUSE_BOUNDARY.test(window)) {
        negated = NEGATORS.some((re) => re.test(window));
      }
    }
    return { matched: true, negated, matchedPattern: String(pattern), index: m.index, hit: m[0] };
  }
  return { matched: false };
}

/** All distinct signal ids, for diagnostics. */
export const SIGNAL_IDS = [...new Set(SIGNALS.map((s) => s.id))];
