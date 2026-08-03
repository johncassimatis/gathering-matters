# Framer submission forms

Versioned source for the two public Gathering Matters submission forms. Each is a
Framer **Code Component** — these files are the source of truth; to update a live
form, edit here then paste into the Framer component of the same name.

| File | Framer component | Source | Purpose |
|---|---|---|---|
| `PreservationProjectForm.tsx` | PreservationProjectForm | `listening_program` | Listening Program |
| `YoungAdultInitiativeForm.tsx` | YoungAdultInitiativeForm | `young_adult_initiative` | Young Adult Initiative |
| `gmFormValidation.ts` | (shared code file) | — | Shared validators/formatters/response logic |

**Paste order in Framer:** create `gmFormValidation.ts` first (both components import
`./gmFormValidation`), then paste the two components.

## What they do

- Post **JSON** to `https://cms.gatheringmatters.com/gm-intake/submissions`
  (HTTPS — required; an HTTP URL is blocked as mixed content on the published site).
- Metadata only. **No file uploads** — do not switch to `multipart/form-data`
  until the attachment work is separately deployed and verified.
- Shared, Oaken-quality UX: custom validation (trim, reject whitespace-only),
  per-field messages + highlight + `aria-invalid`/`aria-describedby`, errors clear
  on edit, `role="alert"` form error, focus first invalid field, `libphonenumber-js`
  phone validation (submits canonical E.164), loading state, logical
  duplicate-submit guard, safe response classification, and 202 handled without
  exposing anti-spam internals.

## Per-form rules

| | Listening Program | Young Adult Initiative |
|---|---|---|
| Email | **required** (administrative contact) | **required** (follow-up is a core purpose) |
| Phone | optional | optional |
| `consent_to_review` | **required** — from the agreement checkbox | **required** — from the agreement checkbox |
| `consent_to_contact` | **required** — same agreement checkbox | **required** — same agreement checkbox |
| `consent_to_updates` | optional — separate second checkbox | optional — separate second checkbox |
| `preferred_follow_up` | not collected | **required** (`email` \| `phone` \| `video`) |
| Age | "Your age range" (`AGE_OPTIONS`: `18_24 … 65_plus`) | restricted to `18_24` only (`YAI_AGE_OPTIONS`) — programme eligibility |
| Body | description only | description only (no follow-up append) |

**Name & order:** Full name is split into **First / Last** side by side; **First/Last name and Email come first**, then phone, age, title, description, consents. `submitter_name` is sent as `"First Last"` (trimmed) — no backend change.

**Oaken-parity interaction model** (`GM_FORM_CSS` in `gmFormValidation.ts`, adapted to GM's palette): per-field **error icon** inside the input + red border + pink fill + message (`role="alert"`), shown on Submit and cleared on input; field **hover / focus (ring) / error / error-focus** states; button **hover / active / focus-visible / disabled(loading)** states; phone **formats as you type**; `inputmode` on email/phone. Validation fires on Submit only (matching Oaken); phone stays optional (a GM rule, unlike Oaken's required phone).

**Two checkboxes, deliberately separate** (Phase 3 — matches the `gm-intake` contract):

1. **Agreement — required, both forms.** One checkbox sets *both* `consent_to_review` and
   `consent_to_contact`. This is service consent: permission to review the submission and to
   follow up **about that submission** (schema: `submission.contact_consent`). The backend
   rejects a submission without it, on either source.
2. **Updates — optional, both forms.** A second checkbox sets `consent_to_updates`
   (schema: `submission.updates_consent`). This is marketing consent and is **never** bundled
   into the required agreement — a marketing opt-in has to be freely given. It never blocks
   submit.

Do not merge these into one checkbox, and do not make the updates box default-checked.

## Age field — meaning

The dropdown populates `submitter_age_range`, which is **the submitter's own age**,
not the submission's target audience. Target audience is the separate
`submission.audience` column (`all_age` / `young_adult`), which the public endpoint
does not set. Do not relabel this as "target audience".

Label → machine value: `18–24→18_24`, `25–34→25_34`, `35–44→35_44`, `45–54→45_54`,
`55–64→55_64`, `65+→65_plus`. No `Under 18`, no `Prefer not to say`. The UI only
submits machine values.

## Composition

Both forms use an Oaken-style card container: a rounded, subtly-shadowed card
(GM cream `#FFFDF8`), a **centered heading** (Manrope, slate `#25313B`) with a
bottom rule, a 16px vertical rhythm, a **2-col First/Last name grid**, and a
**prominent right-aligned pill button** (navy `#1D1D7A`, 220px min-width, 8px
right margin). Per-field **error icon** on inputs (centered), textarea
(top-aligned), and select (left of the chevron). Palette is GM's own, sampled
from the live site — not Oaken's gold.

## Dependency — libphonenumber-js (via esm.sh)

Phone validation/formatting uses the **real `libphonenumber-js`** library,
imported from a pinned esm.sh URL:

```ts
// @ts-ignore  (URL module resolves at build time; isolated typecheck can't see its types)
import { parsePhoneNumberFromString, AsYouType } from "https://esm.sh/libphonenumber-js@1.13.9"
```

Framer rejects the **bare** `"libphonenumber-js"` specifier ("not a valid npm
package"), but the **esm.sh URL builds correctly through both the Framer editor
and the Server API** (verified — the component produces an export/insertURL). No
manual editor step is required. `build-inlined.mjs` hoists this import (with its
`@ts-ignore`) to the top of each deployed component.

Behavior (following Oaken): an explicit leading `+` is parsed as **international**
(real per-country validation); a number **without `+`** is parsed against the
default country **US**. Canonical **E.164** comes from the library; formatting is
live/as-you-type via `AsYouType`. One deliberate difference from Oaken: we do
**not** synthesize a `+` for a bare non-US-shaped number (Oaken guesses it's
international) — a bare number stays US, per the GM decision not to guess a
country from digit count.

## Deploying to Framer (Server API)

`deploy/` holds the automation used to push these to test pages via the Framer
Server API (key in `../gathering-matters-directus/tag-sync/.env`):

- `deploy/build-inlined.mjs` — inlines the shared `gmFormValidation.ts` helpers into each
  component (hoisting the esm.sh `libphonenumber-js` import to the top), producing
  self-contained `*.inlined.tsx`. The headless build can't resolve cross-code-file imports,
  so the 3-file structure in `../` stays the clean reference. Framer **Property Controls are
  kept**, so the deployed component exposes the same designer panel as the source.
  Regenerate and commit the `.inlined.tsx` files whenever a source component or the shared
  helper changes — `git diff` on `deploy/` after a run should be empty.
- `deploy/deploy.mjs` — idempotent: creates/updates the two code files, typechecks
  them via the API, creates the two test pages, and places each component. Never
  touches existing pages. Holds publish unless `--publish` is passed.

`deploy.mjs` imports `framer-api` by absolute path out of `tag-sync/node_modules` (the only
place it is installed), so that install is a prerequisite — without it you get a bare
module-not-found. From the repository root:

```bash
npm --prefix gathering-matters-directus/tag-sync ci    # once per checkout — provides framer-api
node framer/deploy/build-inlined.mjs
node --env-file=gathering-matters-directus/tag-sync/.env framer/deploy/deploy.mjs
```

## Blocker before it works in the browser — CORS (deployment, not code)

Verified 2026-07-26 against production: the deployed Directus `CORS_ORIGIN` is pinned
to a single Framer **plugin CDN** origin
(`https://6q0czurpubwh4jj7iqi2kemta.plugins.framercdn.com`), **not** the origin that
serves these forms. A cross-origin POST from the published site is therefore
CORS-blocked. **Fix (on Render, env only, not weakening):** set `CORS_ORIGIN` to a
comma-separated allowlist = existing plugin origin **+** the form's published site
origin **+** the Framer preview origin. Do **not** use `*`.
