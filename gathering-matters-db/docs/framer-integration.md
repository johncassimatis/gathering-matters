# Directus → Framer CMS Integration — Architecture (Variant A)

**Status:** Phases 0, 2, 3, 4 complete. The read-only Framer Sync token is live on production (`cms.gatheringmatters.com`) and the Framer CMS collection is mapped to the published-content allowlist. **Update (2026-08):** the allowlist is now **11 fields** (it adds `featured_image_id`), and the items listed below as deferred — **tags, featured images, and removal-on-unpublish — are all implemented** via `tag-sync/`. Remaining: **Phase 5** (sync↔publish boundary automation) and **Phase 6** (staff runbook).

## Production deploy requirement: CORS
**Resolved (2026-08):** `CORS_ORIGIN` on Render now allowlists the published site origin alongside the plugin and preview origins (comma-separated, never `*`), and a live preflight echoes it. The single-origin example below is kept as context for how the requirement works.

The Framer plugin runs in a browser iframe, so the production Directus deploy (Render) **must** allow the plugin's origin. Required env vars (set on Render, then redeploy):
```
CORS_ENABLED=true
CORS_ORIGIN=https://6q0czurpubwh4jj7iqi2kemta.plugins.framercdn.com
```
The plugin origin is `https://<pluginId>.plugins.framercdn.com` (stable per plugin). A literal `CORS_ORIGIN=https://framer.com` does NOT work (the plugin's origin is the framercdn subdomain, not framer.com). Alternatives: a comma-separated list, or `CORS_ORIGIN=true` (reflect any origin — broader, still token-gated). Without this, the plugin fails with "Failed to fetch".

## Why Variant A (and not a SQL view)
The intended design was a published-only `content_public` **view** that also flattened tags. Phase 0 proved Directus 12 **cannot expose a plain PostgreSQL view as a collection** (a view has no primary key, which Directus requires). The integration instead uses a **scoped, read-only Directus role on the existing `content_item` collection** — no schema change; the security boundary is enforced by Directus, which the plugin cannot bypass.

## Public field contract (exact v1 allowlist)
The Framer Sync policy grants **read** on `content_item` limited to **exactly** these 11 fields:

```
id  slug  title  summary  body  author  external_url  featured  published_at  content_type_id  featured_image_id
```

| Field | Notes |
|---|---|
| `id` | UUIDv7 — the plugin's Slug/match field |
| `slug` | human slug (the row filter requires it non-null) |
| `title`, `summary`, `body` | map as `string` in Framer; `body` HTML→rich-text fidelity is a Phase 3 item |
| `author`, `external_url`, `featured`, `published_at` | |
| `content_type_id` | opaque UUID in v1 (type-name resolution deferred) |
| `featured_image_id` | file id of the card image; the `tag-sync` reconciler reads `/assets` and sets Framer's Image field (Framer re-hosts it), gated to scan-clean files |

**Never exposed** (not in the field list): `editorial_notes`, `status`, `source`, `user_created`, `user_updated`, `date_created`, `date_updated`, `privacy_reviewed_at/by`, `metadata`, `sort`, `search_tsv`, and all `submission`/moderation data. (`status`, `published_at`, and `slug` are used by the **filter** but are not readable — Directus evaluates filters server-side on fields the token cannot see.)

**Row filter (server-side, exact):**
```
status = 'published'  AND  published_at IS NOT NULL  AND  published_at <= $NOW  AND  slug IS NOT NULL
```
As Directus permission JSON:
```json
{"_and":[{"status":{"_eq":"published"}},{"published_at":{"_nnull":true}},{"published_at":{"_lte":"$NOW"}},{"slug":{"_nnull":true}}]}
```
Draft, archived, future-dated, and slug-less rows are never returned.

## Category filtering via `content_type` (added post-Phase-4)
To let Framer build category tabs/dropdowns from readable type names (Framer's dynamic filters need a Collection Reference or option field, not a raw UUID), the policy also grants **read on `content_type`** — fields **`id, name, slug`**, filter **`is_active = true`**, no writes. Verified read-only on branch and production (active-only, safe fields, POST/PATCH/DELETE → 403).

**Framer-side (Phase 3 follow-up, needs a Framer session):** sync `content_type` as a **second** Framer CMS collection, then remap `content_item.content_type_id` (a many-to-one) as a **Collection Reference** to it — the plugin supports m2o as references (Phase 0). Then: CMS list → Content → Filter → the content-type field → Dynamic → Tabs/Dropdown. True multi-**tag** filtering is still v1.5 (tags are many-to-many; needs a trigger-maintained real table or a multi-reference-capable path).

## Directus setup recipe (per instance)
1. **Policy** — name **`Framer Sync (read-only)`**: `admin_access = false`, **`app_access = true`**, a **read** permission on `content_item` (field list + filter above) **and** a **read** permission on `content_type` (`id, name, slug`; filter `is_active = true`). No create/update/delete, no other collections.
2. **Role** — `Framer Sync`; attach the policy (via `directus_access`).
3. **User** — `framer-sync@…` with that role, `status: active`, and a **static token**. The user is a read-only service account.
4. Phase 3 (mapping): point the plugin at `{DIRECTUS_URL}` + token; **`id` as the Slug/match**; set every text field's Type to **`string`** (the plugin's `text→formattedText` default breaks the sync); **"Sync from Directus"** only.

### Why `app_access: true` is required
The Framer plugin lists collections and fields to build its pickers by reading `/collections` and `/fields`; a content-only token (no app access) gets **403 on `directus_collections`** and cannot select `content_item`. `app_access: true` grants the minimal Directus **app baseline** (schema-metadata endpoints) — it does **not** expose content beyond the single read permission and does **not** expose system-collection *data*: with this policy, `directus_users`, `directus_roles`, `directus_policies`, `directus_settings`, `directus_files`, and `directus_permissions` all return **403** (verified on both branch and production). Exposure is limited to collection/field **structure**, which is acceptable.

### Confirmation: the token is read-only
Verified on branch and production — `GET` eligible items works; `POST`, `PATCH`, `DELETE` on `content_item` all return **403**; unrelated collections (`submission`, `audit_event`, `risk_event`, …) return **403**; `editorial_notes` and draft-by-id return **403**. The policy carries a single `read` permission and nothing else.

## Phase 2 verification results
**Branch (`pierce_dev`, reset from production):** all checks passed — collections listable, `content_item` selectable, only eligible published rows returned (0 draft/archived/future/null-slug leak), `editorial_notes`/draft-by-id/writes/unrelated-collections all 403. (Live Framer connect + `content_item` selection with this exact app_access read-only token pattern was demonstrated in Phase 0.)

**Production (`cms.gatheringmatters.com`, config-only):** policy/role/user/token created; **read-only API verification only** — `GET /items/content_item?limit=1` returns an eligible published item (token sees 16 rows, no null-slug leak); `editorial_notes`, draft-by-id, `POST`/`PATCH`/`DELETE`, unrelated collections, and system-collection data all **403**. No fixtures, no content changes, no migrations, no writes.

## Token rotation / revocation
The static token lives only in the Framer plugin config (and a temporary local handoff file). To rotate or revoke on the production instance:
- **Rotate:** as an admin, `PATCH /users/{framer-sync user id}` with a new `token` (or regenerate in Studio → the user → Token → Generate), then update the Framer plugin config. Old token stops working immediately.
- **Revoke fully:** set the user `status: "suspended"` (or `PATCH` the token to null), or delete the user. Any of these instantly disables sync without affecting content.
- The production Framer Sync user id is recorded out-of-band (not in this doc). Never commit the token to Git, `.env`, docs, or chat.

## Phase 3 handoff
1. In Framer, create a **fresh, empty** regular CMS collection (not managed).
2. Open the Directus plugin → connect with `{DIRECTUS_URL}` + the production token (from the temporary handoff file) → select `content_item`.
3. Map: `id`→Slug/match; **set all text fields to `string`**; rename the `slug` field's Framer target if it collides with the built-in Slug (e.g. `content_slug`) or omit it.
4. Run **"Sync from Directus"**. Re-syncs are idempotent (matched by `id`); conflicts offer "Use Directus".
5. Delete the local token handoff file afterward.

## Open items / caveats (before go-live)
- **Tags + removal reconciliation — implemented** (`gathering-matters-directus/tag-sync/`, Framer Server API). Two jobs in one command, run *alongside* the plugin:
  1. **Tags:** pushes active topic/audience/region tags into Framer `Topics`/`Audiences`/`Regions` collections + `topics`/`audiences`/`regions` **Multi Collection Reference** fields on `Directus` (the plugin can't sync the m2m).
  2. **Removal:** the plugin never deletes, so this removes Framer `Directus` content items no longer **Framer-eligible** (`status=published AND published_at NOT NULL AND published_at<=now AND slug NOT NULL` — so an **archived** item is removed) and stale `Content Types` that are inactive in Directus **and** unreferenced.
  Safeguards: fail-closed Directus reads, UUID-only matching, referenced-type guard, mass-deletion guard (`MAX_DELETES`, `--force` override), dry-run, idempotent no-op; never touches plugin-owned fields, `FAQ`, or `How it works`. Requires read-only Directus perms on the Framer Sync policy for `content_item`, `content_type`, `tag`, `content_item_tag`, plus `directus_files` (image-only) and `file_scan` for the featured-image sync. Applied + verified on production. See `tag-sync/README.md` for commands, env/secrets, safeguards, rotation, and the future Render-Cron plan.
- **Featured images — implemented (2026-08).** `featured_image_id` is now in the allowlist; the `tag-sync` reconciler reads `/assets` (via an image-only `directus_files` read grant on the Framer Sync policy) and sets Framer's Image field, which Framer re-hosts. Only scan-clean (`NO_THREATS_FOUND`) files are pushed.
- **Null-slug published items** are excluded by the `slug IS NOT NULL` filter (external-url-only items have no Framer page).
- **Removal-on-unpublish — implemented (2026-08).** The Framer plugin never deletes, but the `tag-sync` removal reconciliation removes Framer items that are no longer Framer-eligible (e.g. archived or unpublished). No manual "delete in Framer" step is needed; see `tag-sync/README.md`.
- **`body` rich-text fidelity** (HTML → Framer formatted text) to be confirmed in Phase 3.
- **Reachability** — the Framer plugin cannot reach `http://localhost`; use the production HTTPS URL (or a temporary tunnel for local testing).
