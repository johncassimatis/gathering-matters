# Gathering Matters

Monorepo for the Gathering Matters content platform: a Flyway-managed PostgreSQL schema, a
Directus 12 runtime with six custom extensions, and the public Framer submission forms.

| Directory | What it owns | Its own README |
|---|---|---|
| `gathering-matters-db/` | PostgreSQL schema. Flyway migrations are the **only** way structure changes. | [Database setup](#database-setup-gathering-matters-db) (this README) |
| `gathering-matters-directus/` | Directus 12 runtime: Docker image, extensions, API tests. | [Directus runtime](#directus-runtime-gathering-matters-directus) (this README) |
| `gathering-matters-directus/tag-sync/` | Directus → Framer tag sync + removal reconciliation. | [`tag-sync/README.md`](gathering-matters-directus/tag-sync/README.md) |
| `framer/` | Source of truth for the two public submission form components. | [`framer/README.md`](framer/README.md) |
| `scripts/` | Repo-root wrappers (`npm run sync:framer-tags*`). | [`tag-sync/README.md`](gathering-matters-directus/tag-sync/README.md) |
| `gathering-matters-db/docs/` | Design & architecture docs (Framer integration, S3 scan-gating, submission attachments, reconciliation). | [`docs/README.md`](gathering-matters-db/docs/README.md) |
| `infra/aws/` | AWS storage-security stack (private S3 media bucket + GuardDuty malware scanning) and the Render/Directus deploy handoff. | [`infra/aws/README.md`](infra/aws/README.md) |

**Current stack:** Neon PostgreSQL 18 (`neondb`, `uuidv7()` PKs) · Flyway Community 12.8.2-rc2175 ·
Directus 12.0.2 · Node 20+.

**Working directory matters.** Flyway runs from `gathering-matters-db/`; `docker compose` runs from
`gathering-matters-directus/`. Every command block below is labelled.

---

## Read this first: the Directus bootstrap boundary

Migrations V004+ reference Directus system tables (`directus_users`, `directus_files`), so the
database and Directus must be brought up **interleaved**. V004 has a guard that raises a clear error
if those tables are missing — hitting it is expected, not a bug.

```text
V001–V003   pre-bootstrap    plain application schema
--- Directus bootstrap ---
V004–V009   post-bootstrap   reference directus_users / directus_files
```

Full sequence for a **fresh branch** (e.g. after resetting a personal Neon branch). Directory in brackets:

```text
1. [db]       flyway migrate -target=003_20260623141647          through the last pre-bootstrap migration
2. [db]       run provisioning/02_directus_role_setup.sql        as neondb_owner — gm_directus must exist BEFORE bootstrap
3. [directus] docker compose run --rm directus bootstrap
              docker compose up -d directus                       creates the directus_* system tables
4. [db]       run provisioning/03_directus_post_bootstrap_grants.sql   as neondb_owner — REFERENCES for gm_migrator
5. [db]       flyway migrate                                      applies V004 … V009
6. [db]       run provisioning/04_ and 05_                        as neondb_owner — gm_directus app-table grants
7. [db]       run provisioning/06_test_runner_role.sql            optional; only if running the API test suite
```

Steps 6 and 7 must come **after** step 5 — they grant on `content_item_file` and `audit_event`,
which V004 creates. Skipping step 6 leaves Directus running but every custom endpoint failing with
permission-denied.

If your branch is already bootstrapped and you're only adding a pre-bootstrap migration, a plain
`flyway migrate` is fine. The boundary only matters when post-bootstrap migrations are pending on a
branch with no `directus_*` tables.

---

## Database setup (`gathering-matters-db/`)

```text
DIRECTORY: gathering-matters-db
```

```bash
cp flyway.user.toml.example flyway.user.toml   # PowerShell: Copy-Item
flyway info                                    # defaults to your personal branch
```

Fill in your personal Neon branch URL, login role, and password:

```toml
[environments.personal]
url = "jdbc:postgresql://YOUR_BRANCH_HOST.neon.tech/neondb?sslmode=require&channel_binding=require"
user = "your_dev_login"     # pierce_dev / aaron_dev
password = "your-password"
```

Use the Neon **direct** endpoint, not `-pooler` — Flyway needs a persistent session.
Never commit `flyway.user.toml`. Never use `neondb_owner` for normal work.

### Roles

```text
developer login (pierce_dev / aaron_dev) → SET ROLE gm_migrator → run migrations
```

`initSql = "SET ROLE gm_migrator"` in `flyway.toml` means every migration runs as the shared
`gm_migrator` role, so schema objects are owned consistently regardless of who applied them.
`gm_migrator` is `NOLOGIN`.

`gm_directus` is the separate `LOGIN` role the Directus container connects as. Ownership is
deliberately split: **`gm_migrator` owns the application schema, `gm_directus` owns the
`directus_*` system tables** it creates at bootstrap. `gm_directus` gets least-privilege grants on
application tables — never ownership, never DDL, never Flyway. Its credentials live only in the
Directus `.env`.

All role setup is manual, run once per branch by the project owner as `neondb_owner`. **Never put
roles, passwords, or grants in `migrations/`.**

```text
provisioning/01_dev_roles.sql                       gm_migrator + developer logins
provisioning/02_directus_role_setup.sql             gm_directus (BEFORE bootstrap)
provisioning/03_directus_post_bootstrap_grants.sql  REFERENCES for gm_migrator (AFTER bootstrap)
provisioning/04_directus_grants_on_content_table.sql    gm_directus read/write on app tables (AFTER V004)
provisioning/05_directus_editorial_workflow_grants.sql  gm_directus editorial grants (AFTER V004)
provisioning/06_test_runner_role.sql                gm_test_runner (AFTER V006)
```

### Personal branches

Each developer has a personal Neon branch reset from the `production` root branch. Reset it from the
Neon console before starting a schema change — it's a destructive refresh, which is the point.

Do **not** use `flyway clean`; it's disabled in config and should stay disabled.

---

## Directus runtime (`gathering-matters-directus/`)

Prerequisites: Docker Desktop.

```text
DIRECTORY: gathering-matters-directus
```

```bash
cp .env.example .env               # PowerShell: Copy-Item
docker compose run --rm directus bootstrap
docker compose up -d
docker compose logs -f directus
```

The `test-runner` service is behind the `test` Compose profile, so the default
`docker compose up -d` does not require `.env.test`. Create `.env.test` only
when running the API test suite:

```bash
cp .env.test.example .env.test
docker compose run --rm test-runner
```

Filling in `.env` — the decisions that matter beyond the listed values:

* `DB_USER=gm_directus`, the **direct** Neon endpoint (not `-pooler`), `DB_SSL=true`. Directus holds
  session state that Neon's transaction pooler breaks, and bootstrap is DDL.
* Generate `SECRET` as a long random value. PowerShell:
  `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))`
* Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` so bootstrap creates the first admin non-interactively.
* Leave `LICENSE_KEY` **empty** on personal branches — the OIG license binds to `PUBLIC_URL` on
  first use, so it's reserved for the durable staging instance.
* `GM_RISK_HASH_SECRET` and `GM_SEARCH_CURSOR_SECRET` must be set before the endpoints work.
* `GM_*_CONSENT_VERSION` silently defaults to `v1` if unset — set it deliberately, it's stamped onto
  every stored consent record.
* `GM_PROMOTION_ROLE_IDS` can stay unset until the role matrix exists; the promotion operation
  safely refuses without it.
* `CORS_ENABLED` / `CORS_ORIGIN` must list every browser origin that calls the API (Framer plugin
  CDN origin, published site origin, preview origin) as a comma-separated allowlist. Never `*`.

Never commit `.env` or `.env.test`.

### Extensions

Six extensions live in `extensions-src/`, all **baked into the Docker image** by the `Dockerfile`
(`npm ci` from the committed lockfiles, then `directus-extension build`). There is no bind mount —
the baked artifacts are what run.

| Extension | Type | Purpose |
|---|---|---|
| `gm-intake` | endpoint | public `POST /gm-intake/submissions` |
| `gm-library` | endpoint | public read-only search + item detail |
| `promote-submission` | operation | approved submission → draft content item |
| `gm-scan-consumer` | hook | polls the GuardDuty SQS queue, clears scanned files |
| `gm-publish-gate` | hook | moves files between folders as publication changes |
| `gm-review` | endpoint | authenticated reviewer metadata |

The scan and upload behavior ships disabled by default:

* `GM_PUBLIC_FILE_UPLOADS_ENABLED` gates public file uploads.
* `GM_SCAN_CONSUMER_ENABLED` gates GuardDuty scan-result processing.
* `GM_SCAN_GATING_ENABLED` gates publication/download file gating.

These flags control behavior; the extensions still load. `gm-review` is loaded
regardless and uses `GM_REVIEW_ROLE_IDS` and `GM_REVIEW_DOWNLOAD_ROLE_IDS` for
authorization. Rebuild with:

```bash
docker compose build directus && docker compose up -d --force-recreate directus
```

To iterate on an extension without rebuilding, build it locally into `./extensions/` and opt into the
bind-mount override (deliberately *not* named `docker-compose.override.yml`, so it never loads
silently):

```bash
docker compose -f docker-compose.yml -f docker-compose.staged-extensions.yml up -d directus
```

Set `EXTENSIONS_MUST_LOAD=true` in `.env` so a failed extension makes Directus exit loudly rather
than start half-broken. Verify the load:

```bash
curl.exe -i http://localhost:8055/gm-library/search
```

* `500 {"error":"search_unavailable"}` — route loaded, `GM_SEARCH_CURSOR_SECRET` unset.
* `200` with an empty feed — route loaded, secret set.
* `404` — the extension did not load. Check the logs.

### API tests

```bash
cp .env.test.example .env.test     # fill in gm_test_runner credentials
npm ci
npm run test:render                # seeds, runs vitest, cleans up, writes test_run_audit
```

Requires `gm_test_runner` (provisioning/06) and V006 applied. **Set `GM_TEST_MODE=true` on the
Directus instance under test** — without it the intake endpoint doesn't tag `risk_event` rows with a
run id, cleanup can't remove them, and the endpoint's 5-per-hour rate limit will fail the next run
inside the same hour.

---

## Daily commands

```text
DIRECTORY: gathering-matters-db
```

`personal` is the default environment, so a bare command targets your branch:

```bash
flyway info        # migration status
flyway validate    # check files against the database
flyway migrate     # apply pending migrations
flyway add -description=add_content_items   # scaffold a new migration
```

Target production deliberately: `flyway migrate -environment=production`, only from `main`, only
after the migration is merged.

### Change workflow

```text
main pull → reset personal Neon branch from production → git branch → write migration
→ test on personal → PR → merge → flyway migrate -environment=production from main
```

Migration filenames use an ordinal-plus-timestamp so they sort deterministically and read clearly:
`V004_20260629194749__directus_relations_privacy_audit_files.sql`. `flyway add` generates a bare
timestamp — rename it to keep the ordinal prefix.

---

## Production / deployment

Production runs on **Render** and **AWS**; operational details live in `infra/aws/`.

* **Directus runtime** — the Render web service **`gathering-matters-database`**, which
  **auto-deploys from `main`** (root directory `gathering-matters-directus/`, so only changes there
  trigger a redeploy). Currently on Render's free tier, which spins the service down when idle.
* **Database** — the Neon PostgreSQL `production` branch. Apply migrations with
  `flyway migrate -environment=production`, from `main` only, after merge.
* **File storage + malware scanning** — a private S3 media bucket in `us-west-2` with **GuardDuty
  Malware Protection** (CloudFormation stack `gathering-matters-storage-security`). GuardDuty scans
  every object and posts results to the `gathering-matters-s3-scan-results` SQS queue; the
  `gm-scan-consumer` hook records each verdict in `file_scan` and moves the file between the pending
  and clean folders. **Deployed and live in production** (verified 2026-08). See
  [`infra/aws/README.md`](infra/aws/README.md) for the stack and
  [`infra/aws/DIRECTUS_RENDER_HANDOFF.md`](infra/aws/DIRECTUS_RENDER_HANDOFF.md) for the Render
  environment and day-2 operations.
* **Framer sync** — the Directus plugin pulls published content; tags and featured images are
  reconciled by the manual `npm run sync:framer-tags` step (always `:dry-run` first). It is manual
  only because the Render service is on the free plan; an always-on plan lets it move to a scheduled
  job.

---

## Rules

* **Secrets stay out of Git.** `flyway.user.toml`, `.env`, `.env.test`, `tag-sync/.env`. Share real
  passwords through a password manager.
* **Never edit an applied migration on a shared database.** Flyway checksums them. Fix forward with a
  new migration — Flyway Community has no undo.
* **`flyway repair` is not part of the workflow.** It rewrites history metadata, not the schema. Use
  it only when the history table itself is the problem.
* **Structure is SQL-first.** Tables, columns, constraints, indexes, foreign keys, functions, and
  triggers all go through Flyway. Directus owns its system tables plus content and editor
  configuration — it must never alter the application schema. Anything that appears in Directus's
  data-model tools without a matching migration is drift to correct.
* **Roles and grants are manual provisioning**, never migrations.
* **Never restore a dev snapshot onto production** once it holds client content. Promote schema with
  Flyway migrations so content survives.

---

## Known gaps at handoff

Tracked issues a new maintainer should expect. None are silent — each fails loudly or is documented
at the point of use.

| # | Issue | Impact |
|---|---|---|
| 1 | **No public form confirmed on a live page.** A site redesign may have left the submission form off the routed public pages. | Confirm a form is actually placed on a public page before trusting end-to-end submission. |
| 2 | **V007 does not exist and never will.** `main` runs V001–V006, V008, V009 — the file-upload work merged as V009. | Treat V007 as permanently void. `outOfOrder` is not enabled, so a migration numbered V007 added later would be **refused** on every branch already at V008+. Never reuse the number. |
| 3 | **No CI.** Nothing runs `flyway validate` or the API suite automatically. | Drift is caught only by review. |

**Recently resolved (were gaps, now verified on prod 2026-08-11):** the CORS misconfiguration
and the unrecorded migration level — production is now at **V009** (`file_scan`, `submission_file`,
`content_item_file` collections exist), so `gm-intake`'s V008 fields are present.

**File uploads / attachment scanning are LIVE in production** (verified 2026-08-11): V009 applied,
`STORAGE_LOCATIONS=s3`, and `GM_PUBLIC_FILE_UPLOADS_ENABLED` / `GM_SCAN_CONSUMER_ENABLED` /
`GM_SCAN_GATING_ENABLED` are all `true` (`GM_STAFF_FILE_UPLOADS_ENABLED` is deliberately `false`).
The happy-path scan loop is **proven**: a GuardDuty scan resolved `NO_THREATS_FOUND` on 2026-08-04 and
the consumer gated it. Still unproven on prod: the **public-form end-to-end** upload (pending a form on
a live page) and the **threat-positive / quarantine** path. Note the flags still default `false` in
`.env.example`, so a fresh local/staging instance ships with the feature off until you set the S3,
GuardDuty SQS, and folder-id blocks — do not enable it piecemeal.

Featured-image sync to Framer is **implemented** (2026-08-17): the `tag-sync` reconciler
sets each item's Framer `Image` field from the Directus asset and Framer re-hosts it, gated so
only malware-scanned (`NO_THREATS_FOUND`) files are pushed. Still deferred, documented in
[`gathering-matters-db/docs/framer-integration.md`](gathering-matters-db/docs/framer-integration.md):
Framer sync↔publish boundary automation.
