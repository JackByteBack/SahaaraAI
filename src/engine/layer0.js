/**
 * SahaARA AI — Layer 0: Deterministic Hard Safety Override
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Runs BEFORE any probabilistic scoring. Zero-hallucination by construction:
 * this is a lexical/regex tripping tree with explicit, enumerable criteria.
 * A language model never has the final word on lethal risk (§7.1).
 *
 *   SO-01 : IMMINENT_PHYSICAL_VIOLENCE
 *           Perpetrator within sensory range + active threat of violence or
 *           weapon identified → forces CRITICAL_IMMEDIATE_DANGER.
 *
 *   SO-02 : EXPLICIT_SELF_HARM_PREPARATION
 *           Stated intent + accessible lethal means or farewell behaviour →
 *           forces CRITICAL_SELF_HARM_PATHWAY, prohibits diagnostic output,
 *           activates crisis transfer.
 *
 * CRIT-01: a safety-critical case must NEVER be silently classified as low.
 * If Layer 0 trips, `bypass_normal_weighting` is true and downstream weights
 * are discarded entirely.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Override code constants. */
export const OVERRIDE = {
  SO_01: "SO-01_IMMINENT_PHYSICAL_VIOLENCE",
  SO_02: "SO-02_EXPLICIT_SELF_HARM_PREPARATION",
};

/** Human-action payloads bound to each override. */
const ACTIONS = {
  [OVERRIDE.SO_01]: {
    action_code: "EMERGENCY_DISPATCH_PROTOCOL",
    description:
      "IMMEDIATE EMERGENCY SERVICES ESCALATION. Provide live location to police dispatch; keep complainant on a quiet line; do not place on hold; verify address on record. Human decision required — Sahaara does not dispatch autonomously.",
    urgency: "IMMEDIATE_ZERO_DELAY",
    queue: "safety_critical",
  },
  [OVERRIDE.SO_02]: {
    action_code: "CRISIS_COUNSELLOR_IMMEDIATE_TRANSFER",
    description:
      "Seamless warm transfer to an on-duty licensed crisis counsellor; engage active listening; avoid disconnection; activate local mobile crisis response if uncontactable. Non-diagnostic — no psychiatric label may be generated.",
    urgency: "IMMEDIATE_ACTIVE_HOLD",
    queue: "self_harm_critical",
  },
};

/**
 * Criterion definitions. Each criterion is a set of alternative patterns; the
 * criterion is satisfied if ANY pattern matches a complainant utterance.
 */
const SO01_CRITERIA = [
  { code: "PERPETRATOR_PRESENT_ON_SCENE", label: "Perpetrator present within sensory range", any: [
    /\bhe( ?'| i)s (outside|at the (gate|door|window)|here|in the (house|building))\b/i,
    /\bright now\b/i, /\bat the gate\b/i, /\bhe is outside\b/i,
    /\bpushing the (door|gate)\b/i, /\bbanging on\b/i, /\bscreaming that\b/i,
    /\bhiding in\b/i, /\bwaiting outside\b/i, /\bcoming (in|up)\b/i,
    /\bbreaking (in|through)\b/i, /\bbreak through\b/i, /\bसमोर\s+आहे/i, /\bबाहेर\s+आहे/i,
  ]},
  { code: "ACTIVE_FORCED_ENTRY_IN_PROGRESS", label: "Active forced entry in progress", any: [
    /\bbanging on the front (window|door)\b/i, /\bkick(ing)? the door\b/i,
    /\bpushing the door\b/i, /\bglass is starting to crack\b/i,
    /\bbreak(ing)? (down )?the door\b/i, /\bbreak through\b/i,
    /\bforcing the (door|lock|gate)\b/i, /\bcrowbar\b/i, /\bदरवाजा\s+तोड/i,
  ]},
  { code: "WEAPON_EXPLICITLY_IDENTIFIED", label: "Weapon explicitly identified", any: [
    /\bcrowbar\b/i, /\bweapon/i, /\bknife\b/, /\bmetal (crowbar|bar|rod|pipe)\b/i,
    /\bgun\b/i, /\bsomething in his hand\b/i, /\b(kerosene|acid) on me\b/i,
    /\bhunting knife\b/i, /\bचाकू\b/i,
  ]},
  { code: "EXPRESSED_LETHAL_INTENT", label: "Expressed lethal intent against complainant", any: [
    /\bgoing to kill\b/i, /\bhe('ll| will) kill\b/i, /\bkill me\b/i,
    /\bfinish me\b/i, /\bhe('s| is) going to (break|hurt) me\b/i,
    /\bजिवान\s+मारीन/i, /\bमारीन\b/i,
  ]},
  { code: "EXPLICIT_IMMINENCE_MARKER", label: "Explicit present-moment imminence", any: [
    /\bin seconds\b/i, /\bright now\b/i, /\bnow\b/i, /\bat this moment\b/i,
    /\bany second\b/i, /\bआत्ता\b/i, /\battā\b/i,
  ]},
];

const SO02_CRITERIA = [
  { code: "EXPLICIT_SUICIDAL_INTENT", label: "Stated intent to end own life", any: [
    /\bending it\b/i, /\bend my life\b/i, /\bkill myself\b/i,
    /\bdon'?t want to (wake up|live|be here)\b/i, /\bno way forward\b/i,
    /\bno other way (out|forward)\b/i, /\bthere'?s? no way out\b/i,
    /\bthinking about ending\b/i, /\bwant to die\b/i,
    /\bdon'?t want to (do) this (anymore|any more)\b/i, /\bbetter off dead\b/i,
    /\bनाही\s+राहायचं\b/i,
  ]},
  { code: "LETHAL_MEANS_IMMEDIATELY_AVAILABLE", label: "Lethal means immediately accessible", any: [
    /\b(sleeping )?pills\b/i, /\btablets with me\b/i, /\bbottle of (my )?prescription\b/i,
    /\bwhole bottle\b/i, /\bholding them in my hand\b/i, /\bpoison\b/i,
    /\bI have .* (with me|sitting here)\b/i, /\bखांडी\b/i,
  ]},
  { code: "PREPARATORY_ACTIONS_TAKEN", label: "Preparatory / farewell behaviour present", any: [
    /\bwrote (a note|letters?)\b/i, /\bwritten a note\b/i, /\bletters? for my\b/i,
    /\bfarewell\b/i, /\bgave (away|all my)\b/i, /\bput .* in order\b/i,
  ]},
];

/**
 * Evaluate a criterion set against complainant utterances.
 *
 * @param {string} text                    Concatenated complainant speech.
 * @param {Array}  criteria                 Criterion definitions.
 * @param {Array}  [utterances]             Original turns, for evidence capture.
 * @returns {{satisfied:boolean, matched:Array<{code,label,hit,quote,timestamp}>}}
 */
function evaluate(text, criteria, utterances = []) {
  const matched = [];
  for (const c of criteria) {
    for (const re of c.any) {
      const m = re.exec(text);
      if (!m) continue;
      const hit = m[0];
      // Attribute back to the originating turn for verbatim + timestamp.
      const origin = utterances.find((u) => u.text && u.text.includes(hit)) ||
                     utterances.find((u) => u.text && re.test(u.text));
      matched.push({
        code: c.code,
        label: c.label,
        hit,
        quote: origin ? origin.text : hit,
        timestamp: origin ? origin.timestamp || "00:00" : "00:00",
      });
      break; // one hit per criterion is enough to satisfy it
    }
  }
  return { satisfied: matched.length > 0, matched };
}

/**
 * Run the Layer 0 tripping tree.
 *
 * @param {Object} input
 * @param {string} input.text             Concatenated complainant utterances.
 * @param {Array}  input.utterances       [{ text, timestamp, speaker }]
 * @param {string} [input.overrideBias]   Test hook: force an override code.
 * @returns {{tripped:boolean, override_code:string|null, trigger_criteria:string[],
 *            override_timestamp:string|null, bypass_normal_weighting:boolean,
 *            action:Object|null, criteria_detail:Array, notes:string[]}}
 */
export function runLayer0({ text = "", utterances = [], overrideBias = null } = {}) {
  const notes = [];
  const so01 = evaluate(text, SO01_CRITERIA, utterances);
  const so02 = evaluate(text, SO02_CRITERIA, utterances);

  // SO-01 requires presence-or-entry AND (weapon OR lethal intent OR imminence).
  // This prevents "he might come someday" from forcing an emergency dispatch.
  const presence = so01.matched.some((m) =>
    ["PERPETRATOR_PRESENT_ON_SCENE", "ACTIVE_FORCED_ENTRY_IN_PROGRESS"].includes(m.code));
  const lethality = so01.matched.some((m) =>
    ["WEAPON_EXPLICITLY_IDENTIFIED", "EXPRESSED_LETHAL_INTENT", "EXPLICIT_IMMINENCE_MARKER"].includes(m.code));

  const so01Fires = presence && lethality;

  // SO-02 requires intent AND (means OR preparation) — intent alone surfaces as
  // a high-priority non-override signal so that a human still reviews it.
  const intent = so02.matched.some((m) => m.code === "EXPLICIT_SUICIDAL_INTENT");
  const meansOrPrep = so02.matched.some((m) =>
    ["LETHAL_MEANS_IMMEDIATELY_AVAILABLE", "PREPARATORY_ACTIONS_TAKEN"].includes(m.code));

  const so02Fires = intent && (meansOrPrep);

  let code = null;
  // If both trip, self-harm takes the dedicated pathway (it has its own queue)
  // while SO-01 criteria are still reported for the reviewer.
  if (so02Fires) code = OVERRIDE.SO_02;
  else if (so01Fires) code = OVERRIDE.SO_01;

  if (overrideBias) {
    if (!Object.values(OVERRIDE).includes(overrideBias)) {
      throw new Error(`Unknown overrideBias: ${overrideBias}`);
    }
    if (!code) notes.push(`Override forced by test hook overrideBias=${overrideBias}.`);
    code = overrideBias;
  }

  // Intent without means/preparation must still never be silently downgraded.
  if (intent && !meansOrPrep && !code) {
    notes.push(
      "SO-02 intent criterion matched without means/preparation: escalated to CRITICAL_SELF_HARM_PATHWAY under CRIT-01 (no silent under-triage)."
    );
    code = OVERRIDE.SO_02;
  }

  const detail = [...so01.matched, ...so02.matched];

  if (!code) {
    return {
      tripped: false, override_code: null, trigger_criteria: [],
      override_timestamp: null, bypass_normal_weighting: false,
      action: null, criteria_detail: detail, notes,
    };
  }

  return {
    tripped: true,
    override_code: code,
    trigger_criteria: [...new Set(detail.map((m) => m.code))],
    override_timestamp: new Date().toISOString(),
    bypass_normal_weighting: true,
    action: ACTIONS[code],
    criteria_detail: detail,
    notes,
  };
}

/** Human-readable reference table, surfaced in the UI. */
export const OVERRIDE_REFERENCE = [
  { code: OVERRIDE.SO_01, meaning: "Perpetrator present within sensory range + active threat of violence or weapon identified.",
    effect: "Forces Priority = CRITICAL_IMMEDIATE_DANGER; bypasses all downstream weighting." },
  { code: OVERRIDE.SO_02, meaning: "Stated intent + accessible lethal means or active farewell behaviour.",
    effect: "Forces Priority = CRITICAL_SELF_HARM_PATHWAY; prohibits psychiatric diagnostic outputs; activates warm crisis transfer UI." },
];
