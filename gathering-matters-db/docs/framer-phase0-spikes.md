# Framer Integration — Phase 0 Spike Results

**Date:** 2026-07-20 / 2026-07-21 · **Branch under test:** Neon `pierce_dev` (`ep-purple-wind-afeh184s…`), freshly reset from production. **No production endpoint (`ep-bold-bread-afuwwq8t` / `cms.gatheringmatters.com`) was present in the active test configuration at any point.** Local Directus 12.0.2 (baked extensions).

Plugin evaluated: **"Directus · Integrations Plugin" by Directus** (official, free) — Framer Marketplace. Reads/writes a Directus **collection** over REST using a token, matched by slug/ID; no built-in row filter; many-to-one relations only; does not sync JSON/array; **does not delete**; has a conflict resolver (Use Framer / Use Directus / Always overwrite).

The plugin was exercised **live in a real Framer project** (throwaway CMS collection) connected to the branch-local Directus via a temporary Cloudflare HTTPS tunnel (localhost is not reachable from the Framer plugin sandbox).

## Results summary

| Spike | What | Result | Verified |
|---|---|---|---|
| 1 | Published-only rows + safe-field restriction | **PASS** | Directus REST **and live in Framer** (mapping + sync) |
| 2 | Read-only token (pull works, writes rejected) | **PASS** | Directus REST + read-only token used live |
| 3 | Registered PostgreSQL **view** support | **FAIL** | Directus cannot expose a PK-less view (4 methods tried) |
| 4 | Image field shape | **PARTIAL** | Shape known; renders as UUID string in Framer; needs a files grant |
| 5 | Idempotency + update propagation | **PASS** | Verified live in Framer (0-dup re-sync, update, conflict resolve) |

## Spike 1 — published-only + field restriction — PASS
Scoped read-only policy on `content_item`: `fields = [id,status,title,slug,summary,body,author,external_url,featured,published_at,content_type_id,featured_image_id]`, filter `status='published' AND published_at <= $NOW`.
- REST: visible rows = only published+past; `GET /items/content_item/{draft_id}` → **403**; requesting `editorial_notes` → **403** (private text never returned).
- **Live in Framer:** the plugin's Map Fields screen listed **only the safe fields** (no `editorial_notes`/privacy/metadata), and "Sync from Directus" imported **20 items** — the exact count of published+past rows the token can see. Drafts, archived, and future-dated rows never reached Framer.

## Spike 2 — read-only token — PASS
`GET` (pull) → 200; `POST`/`PATCH`/`DELETE` → **403**. The token used live in Framer is read-only, so the plugin's "Sync to Directus" (push) cannot modify the source of truth.

## Spike 3 — registered view support — FAIL (verified four ways)
A plain PostgreSQL view has **no primary key**, which Directus requires to expose a collection:
1. `POST /collections {schema:{}}` → Directus runs `CREATE TABLE content_public …` → **collides with the view → HTTP 500**.
2. `POST /collections {schema:null}` → field-less "folder" collection Directus won't serve.
3. Studio "Create Collection" wizard → completed but bound **zero fields** (no PK).
4. Injecting `directus_collections`+`directus_fields` rows directly and **restarting** → `GET /items/content_public` still **403 "…or it does not exist"**.

**Conclusion:** the plugin can never see a plain-view-backed collection. The Phase 1 `content_public` view (V007) was therefore **removed**; architecture = **Variant A** (scoped role on `content_item`). See `framer-integration.md`.

## Spike 4 — image field shape — PARTIAL
- Image = `content_item.featured_image_id` (UUID → `directus_files`). Asset URL shape = **`{DIRECTUS_URL}/assets/{featured_image_id}`**.
- `GET /assets/{id}` with the scoped token → **403**, unauthenticated → **403**: assets are not reachable, so **rendering requires an explicit `directus_files` read grant** (public role for published-item images, or the sync role).
- **Live in Framer:** mapped as a string, `featured_image_id` displays as the raw **UUID text, not an image**. To render, it must be granted + mapped to a Framer image field (URL-based). Deferred — **v1 has no images**.

## Spike 5 — idempotency + update propagation — PASS (verified live)
- First "Sync from Directus" → **20 items added**.
- Re-sync with no changes → **"0 updated/added, 20 skipped (unchanged)"** — no duplicates; matched by `id`.
- Changed one item's `title` in Directus (the token can't even see `date_updated`, so this proves **value-based** change detection) → re-sync flagged that single item and the **conflict resolver** offered Framer vs Directus values → **"Use Directus"** propagated `…_UPDATED_2` into Framer. 19 others skipped.

## Plugin operational findings (important for the runbook)
- **Reachability:** the Framer plugin sandbox **cannot reach `http://localhost`** ("Failed to fetch"); an **HTTPS tunnel** (Cloudflare quick tunnel used here) is required for local testing. trycloudflare quick tunnels were **flaky** (control-stream drops) and needed a restart. A durable staging Directus URL avoids this.
- **Schema listing needs `app_access`:** a token with only `content_item` read cannot populate the plugin's collection picker (`directus_collections` 403). The sync policy needs **`app_access: true`** (still read-only on content, still no private fields) so the plugin can read `/collections` + `/fields`.
- **Field-type default is wrong:** the plugin maps Directus `text → formattedText`; syncing plain strings then fails ("Expected string but got formattedText"). **Every text field must be set to `string`** (only real-HTML `body` stays formattedText). Framer field types are **sticky** — once created you must recreate the collection to change them (and "Clear all and start over" does not remove already-created Framer fields).
- **Slug collision:** mapping both `id`→built-in Slug and Directus `slug`→a field named "slug" triggers a duplicate-name error; rename the latter (e.g. `content_slug`) or omit it.
- **CMS reset ⇒ conflicts:** resetting the Framer collection wipes the plugin's sync baseline, so later changes can surface as "changed in both" conflicts. Not a defect.

## Screenshots
Directus-side interactions were confirmed via REST/SQL evidence and Directus request logs; the browser screenshot renderer timed out repeatedly, so no image captures are attached. The Framer-side results are as reported live by the operator during the session.

## Recommended architecture
**Variant A** — a published-only, field-restricted **read-only Directus role on `content_item`** (with `app_access:true`), plugin matched by `id`, text fields mapped to `string`. **Tags and images are out of v1** (m2m can't sync; images need a files grant + image mapping). Revisit tags via a trigger-maintained real table (has a PK, unlike a view). Full contract in `framer-integration.md`.
