# gm-framer sync/reconciliation (a.k.a. framer-tags)

Two jobs, one command, run **alongside** the official Directus Framer plugin (never replacing it):
1. **Tags** — pushes Directus many-to-many tags (topic/audience/region) into Framer `Topics`/`Audiences`/`Regions`
   **Multi Collection Reference** fields, so designers build native Framer lists/carousels filtered by
   `Topics contains …`, `Audiences contains …`, etc.
2. **Removal reconciliation** — the plugin creates/updates but never deletes. This removes Framer records that
   are no longer valid in Directus: **content items** whose Directus UUID is no longer Framer-eligible
   (e.g. archived), and **stale Content Types** that are inactive in Directus **and** no longer referenced.

```
Directus (source of truth)
 ├─ Official Directus plugin  → creates/updates content + normal fields + content types
 └─ this reconciliation       → Topics/Audiences/Regions + tag assignments,
                                and REMOVAL of stale content / stale content types
```

The plugin owns normal content fields and content-type creation; this script owns the three tag
collections/fields and the *removal* of Directus-managed records that fell out of eligibility. It
**never** writes plugin-owned content fields. Coexists safely with the plugin's
**"Always overwrite (skip conflict screen)"** option enabled.

**Framer-eligibility (the source-of-truth rule this reconciliation enforces):**
```
status = published  AND  published_at IS NOT NULL  AND  published_at <= now  AND  slug IS NOT NULL
```
An **archived** item is therefore ineligible → removed from Framer on the next run. ("Retire" = `status = archived`.)

## ⭐ Workflow — always follow this order
```
CONTENT changes (new or edited content):
  Directus  →  Framer "Sync from Directus" (Always overwrite)  →  run tag-sync  →  review  →  Publish

TAG-ONLY changes (tags on content already in Framer):
  Directus  →  run tag-sync  →  review  →  Publish
```
> ⚠️ **Never manually edit `Topics`, `Audiences`, `Regions`, or the `topics`/`audiences`/`regions`
> fields in Framer.** This sync **owns** them and overwrites them on every run — any manual edit is lost.
> Manage tags in **Directus** only.

## What it does (idempotent, full reconcile each run)
- Reads (read-only) active `tag`, `content_item_tag`, eligible `content_item`, and active `content_type`
  from Directus. The read token is filtered server-side to eligible/active rows, so its results **are**
  the source-of-truth set.
- **Tags:** ensures `Topics`/`Audiences`/`Regions` exist (each with a `Name` field) + the
  `topics`/`audiences`/`regions` multi-ref fields on `Directus`; upserts active tags (updates `Name`
  on rename); sets each content item's tag fields to its exact active tags (matched by the content_item
  **UUID carried in the Framer `Directus Id` field**, not the human slug or title); prunes tags no
  longer active.
- **Removal:** deletes Framer `Directus` items whose content_item UUID is not in the eligible set;
  deletes `Content Types` items that are inactive in Directus **and** unreferenced by any remaining content.
- Never writes plugin-owned content fields; never touches `FAQ` or `How it works`. Re-running with no
  changes is a **no-op**.

### Safeguards (this deletes production Framer records, so it's defensive)
- **Fail-closed reads:** any non-2xx / malformed Directus response **aborts** before any write — a read
  failure can never be mistaken for an "empty source set" that would delete everything.
- **UUID-only matching:** only records positively identified as Directus-managed (they carry a content_item
  UUID in the `Directus Id` field, or as a UUID-shaped slug) are deletable; manual/arbitrary Framer records
  are never touched.
- **Referenced-type guard:** a content type is never deleted while any remaining Framer content references it.
- **Mass-deletion guard (two backstops):** the run **aborts** (unless `--force`) if total deletions exceed
  `MAX_DELETES` (default 10), **or** if content deletions would remove more than `MAX_DELETE_FRACTION`
  (default 0.5) of the Directus-managed items — the fraction backstop catches an id-scheme mismatch that
  flags most/all items even when the absolute count is under the cap. Dry-run always prints the full plan first.
- **Idempotent:** a second run with no Directus changes is a clean no-op.

## Prerequisites
1. **Directus read-only token** — the Framer Sync static token, whose policy must include
   read on `tag` (`id,name,slug,dimension`, active-only) and `content_item_tag`
   (`content_item_id,tag_id`). (See "Production Directus permission changes" in
   `../../gathering-matters-db/docs/framer-integration.md`.)
2. **Framer Server API key** — Framer Site Settings → General → API. Project-scoped, write-capable.
3. Node 20+ (uses `--env-file`). `npm ci` once to install `framer-api`.

## One-time setup

Run these commands from the repository root once per checkout or machine:

```powershell
npm --prefix gathering-matters-directus/tag-sync ci
Copy-Item gathering-matters-directus/tag-sync/.env.example gathering-matters-directus/tag-sync/.env
```

Fill in `gathering-matters-directus/tag-sync/.env` with the Directus read-only token,
Framer project, and Framer Server API key. The `.env` file is git-ignored and must never
be committed.

## Normal operation

**Order matters** — the plugin must sync new content into Framer *before* the tag-sync can
attach tags to it (a brand-new Directus item must already exist as a Framer `Directus` item):

1. Edit/publish content **and** tags in Directus.
2. Framer → **"Sync from Directus"** (with **Always overwrite** enabled) — brings content items in.
3. From the repository root, preview and then run the tag sync:

   ```powershell
   npm run sync:framer-tags:dry-run
   npm run sync:framer-tags
   ```

   These commands reuse `sync.mjs` with the production-configured `.env`; the first is
   read-only and the second applies the Framer changes.
4. Review in Framer.
5. **Publish** in Framer.

For **tag-only** edits on content that's already in Framer, skip step 2 and run the two
repository-root commands above, then review and publish.

**Large cleanups (mass-deletion guard):** if a run would delete more than `MAX_DELETES` (default 10)
records — e.g. archiving many items at once — it aborts and asks for confirmation. Re-run the dry-run
to inspect the plan, then authorize it explicitly:

```powershell
npm run sync:framer-tags:dry-run -- --force   # preview the full large plan
npm run sync:framer-tags -- --force           # apply it
```

Removing content is driven entirely by **Directus**: to retire content, set `status = archived` in
Directus (do not delete Framer records by hand) — the next reconciliation removes the now-ineligible
Framer items automatically.

Secrets live in `.env` (git-ignored) or real env vars — never in Git.

### Expected output
A plan, then a result. On a healthy no-change run:
```
Directus (read-only): N active tags (topic=…, audience=…, region=…); M junction rows; K items with tags.
Framer 'Directus': 16 items, … fields.
================ PLAN ================
 - ASSIGN topics: 0 content item(s) updated with topic tags
 …
APPLIED to Framer.
```
On changes you'll see `CREATE collection …`, `ADD field …`, `ADD/RENAME/REMOVE tag …`,
and non-zero `ASSIGN …` counts.

### After the sync
Review, then **Publish** in Framer to push everything live. The tag sync updates CMS data only;
it does not publish (pass `--publish` if you ever want it to). If you added brand-new content this
cycle, make sure you did the plugin **"Sync from Directus"** (step 2) *before* running the tag-sync,
or the new items won't exist in Framer yet for tags to attach to — run the tag-sync again after the plugin sync.

## Failure handling
- The sync is **idempotent** — if a run fails partway, just run it again; it converges.
- A failure here **cannot** affect the Directus plugin's content sync (separate process, read-only on Directus).
- Common errors:
  - `403 … permission to access field/collection` → the Directus token is missing the `tag`/`content_item_tag` read permission (see Prerequisites).
  - `Missing config` → an env var is unset.
  - `Bad reference` → (internal) reference must be by Framer item id — already handled by the script.
  - Framer connection hang → the Server API uses a WebSocket; re-run.

## Secret rotation
- **Directus token:** rotate/revoke the Framer Sync user's static token in Directus
  (Studio → the user → Token → Generate, or PATCH the user), then update `.env` / env vars.
- **Framer Server API key:** revoke in Framer Site Settings → General → API and issue a new one; update `.env` / env vars.
- Never commit either. `.env` is git-ignored.

## Future: Render Cron (deployment-agnostic; not set up yet)
The same command moves to a **Render Cron Job** unchanged once a paid Render plan is available:
- **Command:** `node sync.mjs --apply` (env vars supplied by Render, so no `--env-file`).
- **Schedule:** e.g. `*/30 * * * *` (every 30 min) or hourly — tune to how often tags change.
- **Env vars (Render dashboard, secret):** `DIRECTUS_URL`, `DIRECTUS_TOKEN`, `FRAMER_PROJECT`, `FRAMER_API_KEY`, `CONTENT_COLLECTION`.
- **Manual trigger:** the "Run" button on the Render Cron Job.
- **Isolation:** a separate Render service from Directus — a tag-sync failure never touches the content pipeline.
- Publishing stays manual in Framer (or add `--publish`) — same model as the plugin.

## Staff rules (important)
- **Edit content and tags in Directus, not in Framer.** Directus is the source of truth; the
  plugin overwrites content fields and this sync overwrites the tag fields on each run.
- **Keep the Directus plugin's "Always overwrite (skip conflict screen)" enabled** so tag data
  survives content syncs without manual conflict prompts.
