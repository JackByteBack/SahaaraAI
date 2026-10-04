# Sahaara AI

**Non-diagnostic trauma & safety assessment console — human-supervised by design.**

Sahaara AI scores psychological distress, immediate physical safety and contextual
vulnerability as **three orthogonal dimensions**, states its own uncertainty, abstains
when evidence is thin, and hands every decision to a named human reviewer.

It never emits a psychiatric label. It never collapses a single "risk score". A language
model does not get the final word on lethal risk.

```
Node.js · Neon Postgres · Neon Object Storage · Neon Auth
```

---

## Table of contents

- [What it does](#what-it-does)
- [The five design commitments](#the-five-design-commitments)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [The console](#the-console)
- [HTTP API](#http-api)
- [Evaluation suite](#evaluation-suite)
- [Engine reference](#engine-reference)
- [Data model](#data-model)
- [Infrastructure notes](#infrastructure-notes)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Design system](#design-system)
- [Security](#security)
- [License](#license)

---

## What it does

The console runs a **14-case evaluation suite** end to end. Each case is a synthetic
fixture — a short multilingual transcript plus acoustic features — that exercises one
behaviour of the engine. For each case the system returns:

- an **operational priority** from a fixed seven-value vocabulary,
- a **per-dimension score** with a band (`LOW` → `ACUTE`) for each of the three dimensions,
- an **uncertainty state** (`NOMINAL` / `ABSTAIN` / `CONFLICT` / `AMBIGUOUS`),
- **quote-level evidence** — every number traces back to a verbatim span in the transcript,
- the **human action** required, and
- a **trajectory** for follow-up sessions.

Everything is written to an **append-only hash chain**. Every human decision is recorded
beside the AI output, and the chain can be re-verified at any time.

---

## The five design commitments

### 1. Dimensions are orthogonal, never blended

Severe trauma can occur with no imminent danger. Imminent danger can present with flat,
calm affect. Collapsing these into one score destroys exactly the information a reviewer
needs. Each dimension accumulates signed evidence contributions and saturates:

```
score = 1 − exp( −Σ wᵢ / τ )        bounded to [0, 1]
```

`τ` (the scale) differs per dimension: `1.0` for immediate physical safety, `2.6` for
psychological distress, `2.4` for contextual vulnerability. Weights may be **negative** —
protective factors genuinely reduce the score, which is why a strong support network
demonstrably lowers vulnerability rather than being noted and ignored.

### 2. Layer 0 is deterministic and runs first

Before any probabilistic scoring, a lexical/regex tripping tree with explicit, enumerable
criteria runs:

| Code | Condition | Effect |
|---|---|---|
| `SO-01` | Perpetrator within sensory range **and** active threat of violence or weapon | Forces `CRITICAL_IMMEDIATE_DANGER` |
| `SO-02` | Stated intent **and** accessible lethal means or farewell behaviour | Forces `CRITICAL_SELF_HARM_PATHWAY`, prohibits diagnostic output, activates crisis transfer |

If Layer 0 trips, `bypass_normal_weighting` is `true` and **downstream weights are
discarded entirely**. A safety-critical case can never be silently classified as low
(`CRIT-01`).

### 3. The engine abstains

Thin evidence produces `HUMAN_ASSESSMENT_REQUIRED`, not a guess. Insufficient evidence is
a valid output, not a failure.

### 4. Every decision belongs to a human

The system proposes; a named reviewer disposes. A rationale is mandatory — a blank one is
rejected with `422 REVIEW_REJECTED`. Disagreement between human and AI is a first-class,
recorded outcome (`CONFLICT_RECORDED`), not an error to be reconciled away.

### 5. Degradation is visible, never silent

The model service is **polled continuously** on the §10.1 cadence, not called on demand.
When the circuit opens, the assess route transparently returns a `HUMAN_ASSESSMENT_MODE`
record with `operational_priority: null` rather than fabricating a priority. The client
shows an amber banner and manual controls, and the outage is written to the audit chain.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser — console (static, zero-build)                      │
│  Vercel/Geist design language · responsive · a11y-labelled   │
└───────────────┬──────────────────────────────┬───────────────┘
                │ REST                        │ static assets
┌───────────────▼──────────────────────────────▼───────────────┐
│  Node http server — src/api/server.js                        │
│  no framework, no build step, ESM                            │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Engine — deterministic, offline, zero external calls        │
│  layer0 → language → dimensions → safeguard → uncertainty    │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────┐┌─────────────┐
│  Audit chain (append-only, SHA-256)          ││ aiService   │
│  in-process hash chain + Postgres mirror     ││ circuit     │
└──────────────────────────────────────────────┘│ breaker     │
                                                └─────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Neon Postgres          Neon Object Storage      Neon Auth   │
│  cases / evidence /     S3-compatible,           OIDC JWKS   │
│  audit_logs             presigned URLs                      │
└──────────────────────────────────────────────────────────────┘
```

**The engine makes no network calls.** Assessment is pure and deterministic: same input,
same output, no external dependency. That is what makes the 14-case suite reproducible.

---

## Quick start

**Requires Node.js ≥ 20** (developed on 26.x).

```bash
git clone https://github.com/JackByteBack/SahaaraAI.git
cd SahaaraAI
npm install

cp .env.example .env      # then fill in your Neon credentials
npm start                 # → http://localhost:4000
```

Verify the install in one shot — this exercises S3 upload + presigned URL **and** Postgres
introspection:

```bash
npm run check
```

Run the evaluation suite (no infrastructure required — the engine is offline):

```bash
npm test
```

Expected:

```
 Total Cases:  14
 Passed:       14
 Failed:       0
 Overall:      ALL TEST CASES PASSED ✅
```

### Environment

| Variable | Required | Purpose |
|---|:---:|---|
| `DATABASE_URL` | yes | Neon Postgres — use the **pooled** connection string |
| `DB_ROLE` | no | Role assumed after connecting. Default `authenticated`. Blank disables `SET ROLE` |
| `AWS_ENDPOINT_URL_S3` | yes | Neon Object Storage endpoint |
| `AWS_ACCESS_KEY_ID` | yes | Storage credential |
| `AWS_SECRET_ACCESS_KEY` | yes | Storage credential |
| `AWS_REGION` | no | Default `us-east-2` |
| `S3_BUCKET` | no | Default `sahaara` |
| `NEON_AUTH_URL` | no | Neon Auth base URL |
| `NEON_AUTH_JWKS_URL` | no | JWKS for token verification |
| `NEON_REST_URL` | no | PostgREST endpoint |
| `PORT` | no | Console port. Default `4000` |

`src/config.js` validates on boot and **fails fast** on a missing required variable.

---

## The console

A single-page console served from `public/` with **no build step and no framework** —
plain ES modules, five stylesheets, and the tokens from `DESIGN.md`.

| View | Route | What it shows |
|---|---|---|
| Overview | `#/overview` | Suite progress ring, four stat tiles, service health sparkline, recent audit activity |
| Case workspace | `#/cases` | The 14 fixtures with search + category filters, per-case detail tabs |
| Audit chain | `#/audit` | The hash chain, verification result, and per-entry detail |
| Degradation lab | `#/service` | Live kill switch driving the **real** circuit breaker, plus uptime samples |

Also available:

- **⌘K command palette** — navigation, actions, and fixture search.
- **Light / dark themes** — dark is the console default; the stored preference is applied
  before first paint so there is no flash.
- **Responsive** — the left rail collapses to icons at ≤1040px and becomes a bottom tab bar
  at ≤620px. Verified at 390px and 360px: no horizontal overflow, 44px minimum touch
  targets, and 16px form fields so iOS Safari does not zoom on focus.

The degradation lab is not a mock. `POST /api/service` with `{"state":"OFFLINE"}` drives the
same `aiService` circuit breaker the health poller uses, and the next assessment genuinely
returns `HUMAN_ASSESSMENT_MODE`.

---

## HTTP API

Base URL `http://localhost:4000`. JSON in, JSON out.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Service, database and audit-chain health |
| `POST` | `/api/assess` | Run an assessment (degrades automatically) |
| `POST` | `/api/review` | Record a human decision beside the AI output |
| `GET` | `/api/fixtures` | List the TC-01 … TC-14 demo fixtures |
| `POST` | `/api/fixtures/:id` | Run one fixture end to end |
| `GET` | `/api/cases` | Persisted cases |
| `GET` | `/api/cases/:ref` | One case with evidence and audit trail |
| `GET` | `/api/audit` | In-process hash chain and verification result |
| `GET` | `/api/audit/:ref` | Audit entries for one case |
| `POST` | `/api/service` | Demo kill switch — `{"state":"HEALTHY"\|"OFFLINE"}` |

### `POST /api/assess`

```bash
curl -sX POST http://localhost:4000/api/assess \
  -H 'content-type: application/json' \
  -d '{
        "input": {
          "turns": [
            { "role": "user", "text": "I do not feel safe at home anymore." }
          ]
        }
      }'
```

```jsonc
{
  "degraded_mode_active": false,
  "service": { "state": "HEALTHY", "circuit": "CLOSED", "…": "…" },
  "assessment": {
    "record_type": "AI_ASSESSMENT",
    "operational_priority": "MODERATE_PSYCHOSOCIAL_SUPPORT",
    "uncertainty": "NOMINAL",
    "dimensions": { "…": "…" },
    "evidence": [ /* quote-level spans */ ],
    "human_action": { "action_code": "…", "urgency": "…", "description": "…" }
  }
}
```

A degraded request returns `record_type: "HUMAN_ASSESSMENT_MODE"` with
`operational_priority: null`. **That null is the feature** — the system refuses to invent a
priority while the model service is unavailable.

### `POST /api/review`

Requires a non-empty `rationale` and a `justification_category`. A blank rationale returns
`422 REVIEW_REJECTED` — enforced server-side, not just in the UI.

```bash
curl -sX POST http://localhost:4000/api/review \
  -H 'content-type: application/json' \
  -d '{
        "assessment": { /* the assessment object returned above */ },
        "review": {
          "badge_id": "SD-014",
          "role": "intake_officer",
          "action": "CONFIRM",
          "justification_category": "EVIDENCE_REASSESSED",
          "rationale": "Values confirmed line by line against the transcript."
        }
      }'
```

### Persistence is best-effort by design

Case persistence is wrapped so that **a database failure can never take the API down**.
Failures log as `[persist:assess] skipped — …` and the assessment still returns. A clinical
safety tool that returns a 500 because a sidecar write failed is worse than one that logs
and continues.

---

## Evaluation suite

Fourteen fixtures, each targeting one behaviour:

| Case | Title | Exercises | Expected priority |
|---|---|---|---|
| TC-01 | Low Distress | Emotional language alone must not trigger a safety response | `LOW` |
| TC-02 | Moderate Distress | Multidimensional assessment — five dimensions, never one blended score | `MODERATE_PSYCHOSOCIAL_SUPPORT` |
| TC-03 | Threat / Harassment | Context-aware safety reasoning with quote-level provenance | `HIGH_SAFETY_REVIEW` |
| TC-04 | Immediate Danger | The hard safety layer can supersede ordinary prioritisation | `CRITICAL_IMMEDIATE_DANGER` |
| TC-05 | Self-Harm Concern | Dedicated critical-safety pathway with zero-prioritisation latency | `CRITICAL_SELF_HARM_PATHWAY` |
| TC-06 | Calm Voice + Severe Content | Acoustic flattening must not mask a severe transcript | `HIGH_SAFETY_REVIEW` |
| TC-07 | Distressed Voice + No Danger | Distress without danger must not escalate safety | `MODERATE_PSYCHOSOCIAL_SUPPORT` |
| TC-08 | Marathi + English Code-Switching | Multilingual, code-switched input | `MODERATE_PSYCHOSOCIAL_SUPPORT` |
| TC-09 | Insufficient Evidence | The engine must abstain rather than guess | `HUMAN_ASSESSMENT_REQUIRED` |
| TC-10 | Possible Coercion / Interference | Third-party interference raises verification, not blame | `ELEVATED_HUMAN_VERIFICATION_REQUIRED` |
| TC-11 | Human Disagrees with AI | Recorded disagreement is a valid outcome | `HIGH_SAFETY_REVIEW` |
| TC-12 | Follow-Up Assessment | Longitudinal trajectory across sessions | `MODERATE_PSYCHOSOCIAL_SUPPORT` |
| TC-13 | Conflicting Evidence | Internal contradiction surfaces as `CONFLICT` | `HIGH_SAFETY_REVIEW` |
| TC-14 | AI / System Unavailable | Graceful degradation to human mode | `DEGRADED` |

TC-06 and TC-07 are a deliberate pair: they assert that **neither** a calm voice **nor** a
distressed voice can move the safety priority on its own. Only content can.

```bash
npm test                # all 14
npm run eval:panel      # with full Section 6 On-Screen Intelligence Panels
node src/evaluator.js TC-04   # one case, detailed panel
npm run eval:json       # machine-readable
npm run eval:persist    # write cases + evidence + audit logs to Postgres
npm run eval:s3         # upload markdown & JSON reports, print presigned URLs
npm run eval:all        # both
```

Full specification and the Section 6 panel format:
[`SAHAARA_AI_Test_Cases_and_Demo_Evaluation_Suite.md`](SAHAARA_AI_Test_Cases_and_Demo_Evaluation_Suite.md) ·
[`sahaara-ai-final-test-suite.md`](sahaara-ai-final-test-suite.md)

---

## Engine reference

### Priority vocabulary

| Value | Meaning |
|---|---|
| `LOW` | Distress present, no safety implication |
| `MODERATE_PSYCHOSOCIAL_SUPPORT` | Support pathway indicated |
| `HIGH_SAFETY_REVIEW` | Safety-relevant, human review required |
| `CRITICAL_IMMEDIATE_DANGER` | Layer 0 `SO-01` |
| `CRITICAL_SELF_HARM_PATHWAY` | Layer 0 `SO-02` |
| `HUMAN_ASSESSMENT_REQUIRED` | Abstention — evidence insufficient |
| `ELEVATED_HUMAN_VERIFICATION_REQUIRED` | Possible coercion or interference |

### Dimensions and bands

| Dimension | τ | Bands |
|---|---|---|
| Psychological Distress | 2.6 | LOW · MODERATE · HIGH · ACUTE |
| Immediate Physical Safety | 1.0 | SAFE · LOW · HIGH_RISK · EXTREME_LETHALITY_RISK |
| Contextual Vulnerability | 2.4 | LOW · MODERATE · HIGH · SEVERE |

### Pipeline

```
runLayer0            deterministic hard safety override
      ↓
analyseLanguage      tokenise, lexicon match, idiom + code-switch handling
      ↓
acousticDistress     pause ratio, jitter, shimmer, HNR, entropy, substantivity
      ↓
scoreAllDimensions   saturating accumulation, signed weights
      ↓
safeguard            non-diagnostic assertions, prohibited-term scrub
      ↓
uncertainty          evidence sufficiency, conflict detection, information gaps
      ↓
assess               priority, trajectory, evidence, human action
```

### Language and acoustics

- **Multilingual** — English plus Devanagari (Marathi), with the Noto Sans Devanagari face
  loaded for correct rendering. Code-switching between them is handled, not treated as noise.
- **Acoustic features** — `pauseRatio`, `relativePitchJitter`, `shimmerApq3`,
  `harmonicsToNoiseRatio`, `snrNormalised`, `normalisedEntropy`, `substantiveRatio`.
  Computed from supplied features, never from a microphone — this console takes no audio.

### Evidence provenance

`verifyEvidenceProvenance` and `assertEvidenceVerbatim` enforce that every quoted span is a
**verbatim** substring of the input transcript. Evidence that cannot be traced to a real span
is a defect, and the assertion fails the run. `findDiagnosticLanguage` and
`scrubDiagnosticLanguage` strip prohibited clinical phrasing from anything user-facing.

---

## Data model

**PostgreSQL 18** on Neon. Schemas: `auth`, `neon_auth`, `pgrst`, `public`.

### `public` schema

| Table | Purpose | Notable columns |
|---|---|---|
| `users` | Reviewer / supervisor / admin accounts | `phone` UNIQUE, `role` CHECK, `is_active` |
| `sessions` | Login sessions | `token_hash` UNIQUE, `expires_at`, FK → `users` CASCADE |
| `otp_codes` | Phone OTP login | `code_hash`, `purpose`, `expires_at`, `consumed_at`, `attempts` |
| `cases` | Sahaara case records | `case_ref` UNIQUE, `status` CHECK, `transcript`, `safety_state` |
| `evidence_blocks` | Evidence spans within a case | `snippet`, `start_ms`/`end_ms`, `dimension`, `strength`, FK → `cases` CASCADE |
| `audit_logs` | Immutable action log | `actor_type` CHECK, `action`, `details` JSONB, FK → `cases` |

```
users ─┬─< sessions
       └─< otp_codes
cases ──< evidence_blocks
cases ──< audit_logs      (case_id nullable — global events allowed)
```

> **RLS is currently disabled** on all six tables; authorisation happens at the
> role/grant layer only. If this ships multi-tenant, that must be revisited first.

### The `SET ROLE` requirement

**`authenticator` has no direct table grants.** It exists only as the PostgREST login role.
Every `public.*` table is granted to `authenticated`, of which `authenticator` is a member.
Connecting and querying directly fails with:

```
error: permission denied for table users
```

`src/db.js` fixes this automatically on every new pooled connection:

```sql
SET ROLE authenticated;
```

Controlled by `DB_ROLE` in `.env` — set it blank to disable. This is also why the same
`DATABASE_URL` works through the REST API (PostgREST switches roles from the JWT claim) but
not through a raw `pg` query without `SET ROLE`.

---

## Infrastructure notes

### Neon Object Storage

S3-compatible via `@aws-sdk/client-s3` with **path-style addressing** (`forcePathStyle: true`,
required for this endpoint).

| Setting | Value |
|---|---|
| Endpoint | `AWS_ENDPOINT_URL_S3` |
| Bucket | `S3_BUCKET` (**`sahaara`** — not `assets`) |
| Addressing | `forcePathStyle: true` |
| Region | `us-east-2` |

> Presigned URLs are signed with `us-east-1` in the credential scope by the SDK while the
> configured region is `us-east-2`. This is normal for S3-compatible endpoints — the
> signature still validates (verified: HTTP 200 with correct body).

```js
import { upload, getSignedGetUrl, getSignedPutUrl } from "./src/s3.js";

await upload({ key: "uploads/a.txt", body: "hi", contentType: "text/plain" });
const url = await getSignedGetUrl("uploads/a.txt", 3600);   // browser download
const put = await getSignedPutUrl("uploads/b.png", 900, "image/png"); // direct browser upload
```

`getSignedPutUrl` is the one for direct browser uploads — the client PUTs to it and the
server never touches the bytes.

### Audit chain

Append-only and hash-linked:

```
entry_n.hash = sha256(entry_{n-1}.hash + stableStringify(entry_n))
```

`stableStringify` guarantees key-order stability so the hash is reproducible.
`auditChain.verify()` recomputes the whole chain and reports the first broken entry, if any.
The chain lives in-process for the API and mirrors to `audit_logs` for durability.

---

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Serve the console + API on `$PORT` (default 4000) |
| `npm test` / `npm run eval` | Run the full 14-case suite |
| `npm run eval:panel` | All cases with full Intelligence Panels |
| `npm run eval:json` | Machine-readable output |
| `npm run eval:persist` | Persist cases, evidence and audit logs to Postgres |
| `npm run eval:s3` | Upload reports to Object Storage, print presigned URLs |
| `npm run eval:all` | `--persist --upload` |
| `npm run check` | End-to-end health check — S3 upload + presigned URL + DB introspection |
| `npm run db:info` | Server version, database, user, schemas |
| `npm run db:tables [schema]` | List tables |
| `node src/db.js describe <table>` | Columns, constraints, indexes |
| `node src/db.js query "<sql>"` | Ad-hoc query, printed as a table |
| `npm run db:perms` | Roles, grants, RLS policies, memberships |
| `npm run s3:upload -- <key> <body>` | Upload an object, print a presigned GET URL |
| `npm run s3:get -- <key>` | Presigned GET URL (1h) |

Single-case demo with a detailed panel:

```bash
node src/evaluator.js TC-04
```

---

## Project layout

```
.env                     secrets — gitignored
.env.example             documented template
package.json             ESM ("type": "module")
DESIGN.md                design system reference (Vercel/Geist)
src/
  config.js              loads + validates env, fails fast on missing vars
  db.js                  pg pool, SET ROLE, transactions, introspection + CLI
  s3.js                  S3 client, upload/presign/list/head/delete + CLI
  index.js               end-to-end health check
  fixtures.js            the 14 TC-* demo fixtures
  evaluator.js           evaluation harness (--panel --json --persist --upload)
  api/
    server.js            REST API + static console (node:http, no framework)
  engine/                ── the deterministic core ──
    layer0.js              hard safety override (SO-01, SO-02)
    language.js            tokenisation, analysis, code-switching
    acoustic.js            voice-feature extraction
    dimensions.js          saturating scoring, bands
    lexicon.js             signal registry
    evidence.js            quote-level provenance, verbatim assertions
    safeguard.js           non-diagnostic enforcement, priority catalogue
    uncertainty.js         sufficiency, conflict, information gaps
    degraded.js            human-assessment-mode fallback
    review.js              human-in-the-loop decisions
    assess.js              orchestrator — the `assess()` entry point
  services/
    aiService.js          model-service poller + circuit breaker
  store/
    audit.js               append-only hash chain
    cases.js               Postgres persistence
public/
  index.html
  assets/css/             tokens, base, layout, components, views
  assets/js/              app shell, router, store, api, charts, views/*
scripts/
  inspect-perms.mjs       roles, grants, RLS policies, memberships
```

---

## Design system

`DESIGN.md` captures a Vercel/Geist-flavoured design language, and `tokens.css` implements it:

- **One ink tone** carries every heading, CTA and border.
- **Colour is reserved** for status, data and the hero mesh — never decoration.
- **Hairline borders**, not shadows, do the dividing.
- **6px app chrome**, 8–10px panels, pill for the primary CTA.

Dark is the console default. `[data-theme="light"]` swaps to near-white canvas with
`#171717` ink, with contrast ratios documented alongside each token.

The front end is hand-written vanilla ESM — no React, no bundler, no build step. Opening
`public/index.html` through the server is the whole toolchain.

---

## Security

### Rotate credentials before any public release

Credentials for this project were circulated in plaintext during development. **Both must be
rotated before this repository is made public:**

1. **S3 credential** — regenerate in the Neon console, then update `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY`.
2. **Database password** — reset the `authenticator` role password, then update `DATABASE_URL`.

`.env` is gitignored. **Anything pasted into a chat, log or screenshot must be assumed
leaked.**

### Before deploying

- **RLS is off.** All six tables rely on role/grant authorisation only. Multi-tenant
  deployment requires RLS first.
- **CORS is open.** The API sends `access-control-allow-origin: *`. There is no
  authentication middleware on `/api/*` — anyone who can reach the port can run assessments
  and read cases. Put it behind an authenticating proxy before exposing it.
- **The console is a demo harness.** It runs against synthetic fixtures by design. Never point
  it at live case data.

---

## License

Private project. All rights reserved.

The `DESIGN.md` design tokens are a third-party extraction of Vercel's public design language,
maintained by an unaffiliated contributor. Fine as an internal style reference; not appropriate
for public-facing branding.

The fixtures are entirely synthetic. They contain no real transcripts and no real individuals.

---

## Acknowledgements

Built against Neon Postgres, Neon Object Storage and Neon Auth. Design language inspired by
Vercel's Geist system. Engine design follows the NHAA evaluation suite.