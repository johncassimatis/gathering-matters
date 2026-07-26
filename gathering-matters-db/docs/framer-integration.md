# Directus → Framer CMS Integration — Architecture (Variant A)

**Status:** Phases 0, 2, 3, 4 complete. The read-only Framer Sync token is live on production (`cms.gatheringmatters.com`), the Framer CMS collection is mapped to the 10-field allowlist, and a first real sync pulled **16 published items** cleanly (only allowlist fields; no private data). **Remaining: Phase 5** (sync↔publish boundary), **Phase 6** (staff runbook), and the deferred items (tags, images, removal-on-unpublish).

## Production deploy requirement: CORS
The Framer plugin runs in a browser iframe, so the production Directus deploy (Render) **must** allow the plugin's origin. Required env vars (set on Render, then redeploy):
```
CORS_ENABLED=true
CORS_ORIGIN=https://6q0czurpubwh4jj7iqi2kemta.plugins.framercdn.com
```
The plugin origin is `https://<pluginId>.plugins.framercdn.com` (stable per plugin). A literal `CORS_ORIGIN=https://framer.com` does NOT work (the plugin's origin is the framercdn subdomain, not framer.com). Alternatives: a comma-separated list, or `CORS_ORIGIN=true` (reflect any origin — broader, still token-gated). Without this, the plugin fails with "Failed to fetch".

## Why Variant A (and not a SQL view)
The intended design was a published-only `content_public` **view** that also flattened tags. Phase 0 proved Directus 12 **cannot expose a plain PostgreSQL view as a collection** (a view has no primary key, which Directus requires). The integration instead uses a **scoped, read-only Directus role on the existing `content_item` collection** — no schema change; the security boundary is enforced by Directus, which the plugin cannot bypass.

## Public field contract (exact v1 allowlist)
The Framer Sync policy grants **read** on `content_item` limited to **exactly** these 10 fields:

```
id  slug  title  summary  body  author  external_url  featured  published_at  content_type_id
```

| Field | Notes |
|---|---|
| `id` | UUIDv7 — the plugin's Slug/match field |
| `slug` | human slug (the row filter requires it non-null) |
| `title`, `summary`, `body` | map as `string` in Framer; `body` HTML→rich-text fidelity is a Phase 3 item |
| `author`, `external_url`, `featured`, `published_at` | |
| `content_type_id` | opaque UUID in v1 (type-name resolution deferred) |

**Never exposed** (not in the field list): `editorial_notes`, `status`, `source`, `featured_image_id`, `user_created`, `user_updated`, `date_created`, `date_updated`, `privacy_reviewed_at/by`, `metadata`, `sort`, `search_tsv`, and all `submission`/moderation data. (`status`, `published_at`, and `slug` are used by the **filter** but are not readable — Directus evaluates filters server-side on fields the token cannot see.)

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
- **Tags (topic/audience/region) — implemented as a hybrid tag sync** (v1.5). The plugin can't sync the `content_item ↔ tag` many-to-many, so a small Framer **Server API** script (`gathering-matters-directus/tag-sync/`) pushes active tags into Framer `Topics`/`Audiences`/`Regions` collections + `topics`/`audiences`/`regions` **Multi Collection Reference** fields on `Directus`. It runs *alongside* the plugin (plugin owns content fields; the sync owns only the tag fields). Validated on a reset `pierce_dev` + the real GM Framer project: multiple tags, removals, inactivation, renames, idempotent reruns, reconcile-to-empty, and plugin coexistence (with **Always overwrite** enabled). See `tag-sync/README.md` for the manual run command, env/secrets, troubleshooting, rotation, and the future Render-Cron plan. Requires two extra read-only Directus permissions on the Framer Sync policy (`tag`, `content_item_tag`) — approval-gated on production.
- **Images omitted in v1** — `featured_image_id` is not exposed; rendering would need a `directus_files` read grant + a Framer image-field mapping. `GET /assets/{id}` is currently 403.
- **Null-slug published items** are excluded by the `slug IS NOT NULL` filter (external-url-only items have no Framer page).
- **No delete propagation** — unpublishing in Directus does not remove the Framer item; the operational runbook must include a manual "delete in Framer" step.
- **`body` rich-text fidelity** (HTML → Framer formatted text) to be confirmed in Phase 3.
- **Reachability** — the Framer plugin cannot reach `http://localhost`; use the production HTTPS URL (or a temporary tunnel for local testing).
