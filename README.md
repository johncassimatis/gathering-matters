# Gathering Matters

> This README is project onboarding guidance for this repository, not a replacement for official Flyway, Neon, or Directus documentation.

This is a monorepo with two subprojects:

* **`gathering-matters-db/`** — PostgreSQL schema and Flyway migrations. Source of truth for
  database *structure*. Structural changes go through SQL migrations in
  `gathering-matters-db/migrations/`, never manually through a client.
* **`gathering-matters-directus/`** — the Directus 12 runtime: Docker Compose, the three custom
  extensions (`gm-library`, `gm-intake`, `promote-submission`), and bootstrap. Source of truth for
  the CMS/runtime and its configuration.

The two are coupled by one ordering rule: some migrations depend on Directus system tables, so the
database and Directus have to be brought up in a specific interleaved order. That sequence is in
**Migration ordering and the Directus bootstrap boundary** below, and it is the first thing to read
before setting up a fresh branch.

Working directory matters: Flyway commands run from `gathering-matters-db/` (where `flyway.toml`
lives); `docker compose` commands run from `gathering-matters-directus/` (where
`docker-compose.yml` lives). Each command block below is labelled with the directory it runs in.

Current setup:

* Database: Neon PostgreSQL, database `neondb`, Postgres 18 (`uuidv7()` primary keys)
* Migration tool: Flyway Community Edition 12.8.2-rc2175
* CMS/runtime: Directus 12.0.2 (bootstrapped and running on `pierce_dev`)
* Workflow: SQL-first migrations reviewed through GitHub; personal Neon branches before shared development

Production is not set up yet. This repository is development-only for now. A durable, licensed
staging Directus instance is planned but not yet built; the Directus license is intentionally not
applied to any local/personal instance (it binds to `PUBLIC_URL` on first use).

> Bootstrap-boundary reminder: migrations V004 and later reference Directus system tables
> (`directus_users`, `directus_files`) and cannot be applied to a branch until Directus has
> bootstrapped that branch. See the boundary section before migrating a fresh branch.

## Repository structure

```text
gathering-matters/                          monorepo root
├─ .gitignore
├─ README.md                                (this file)
├─ gathering-matters-db/
│  ├─ flyway.toml                           shared Flyway config, no secrets
│  ├─ flyway.user.toml.example              template for local credentials
│  ├─ flyway.user.toml                      local credentials, git ignored
│  ├─ provisioning/                         one-time manual admin scripts, NOT Flyway migrations
│  │  ├─ 01_dev_roles.sql                   gm_migrator + developer login roles
│  │  ├─ 02_directus_role_setup.sql         gm_directus service role + bootstrap grants
│  │  └─ 03_directus_post_bootstrap_grants.sql  REFERENCES + scoped gm_directus app grants
│  ├─ tests/
│  │  └─ verification.sql                   schema-invariant checks (reporting-oriented)
│  └─ migrations/
│     ├─ V001_20260610225550__create_initial_schema.sql
│     ├─ V002_20260623141610__add_content_submissions_and_types.sql
│     ├─ V003_20260623141647__keyset_indexes_placement_risk_event.sql
│     ├─ V004_20260629194749__directus_relations_privacy_audit_files.sql   (post-bootstrap)
│     └─ V005_20260629195805__audit_event_immutable.sql                    (post-bootstrap)
└─ gathering-matters-directus/
   ├─ .env.example                          template for Directus runtime env, git ignored as .env
   ├─ docker-compose.yml
   └─ extensions-src/                        editable extension source (built artifacts are git ignored)
      ├─ gm-intake/        (src/index.js, package.json, package-lock.json)
      ├─ gm-library/       (src/index.js, package.json, package-lock.json)
      └─ promote-submission/ (src/api.js, src/app.js, package.json, package-lock.json)
```

Migration files live in `gathering-matters-db/migrations/`. Versions use an ordinal plus timestamp
(`V00N_<timestamp>`) so they both sort deterministically and stay human-readable. V001–V003 are
pre-bootstrap; V004–V005 depend on Directus system tables (see the bootstrap-boundary section).

Role/access setup lives in `gathering-matters-db/provisioning/` as manual admin scripts run by the
project owner as `neondb_owner`. They are not Flyway migrations.

## One-time setup (database / Flyway)

This section sets up Flyway against the database. Directus setup is a separate section further
down (Getting Directus running).

### 1. Install Flyway CLI

Install the Flyway CLI locally.

Check your version:

```bash
flyway -v
```

This repo was started with:

```text
Flyway Community Edition 12.8.2-rc2175
```

Use this same version if possible. A compatible Flyway 12.x version should also work for normal development.

### 2. Clone the repo

```bash
git clone <monorepo-url>        # confirm the actual monorepo URL; the DB is no longer its own repo
cd gathering-matters
```

Flyway work happens in the database subproject:

```bash
cd gathering-matters-db
```

### 3. Create your local credentials file

Copy the example credentials file:

```bash
cp flyway.user.toml.example flyway.user.toml
```

On Windows PowerShell:

```powershell
Copy-Item flyway.user.toml.example flyway.user.toml
```

Then fill in your Neon/Postgres username and password in `flyway.user.toml`.

Each developer uses their own limited login role.

Example for Pierce:

```toml
[environments.development]
user = "pierce_dev"
password = "your-password"
```

Example for Aaron:

```toml
[environments.development]
user = "aaron_dev"
password = "your-password"
```

Do not commit `flyway.user.toml`.

Do not use `neondb_owner` for normal Flyway work. `neondb_owner` is only for one-time administrative setup, such as creating roles or changing role passwords.

### 4. Confirm the shared development database URL

The shared development database URL lives in `flyway.toml`.

Use the Neon direct endpoint, not the `-pooler` endpoint. Flyway migrations need a persistent database session.

The URL format is:

```text
jdbc:postgresql://<neon-host>/neondb?sslmode=require
```

The shared URL belongs in `flyway.toml`. Personal usernames and passwords belong only in `flyway.user.toml`.

The shared development database is the default Flyway environment. A bare Flyway command targets shared development unless you explicitly pass another environment.

## Database roles

The development database uses separate login roles and a shared migration role.

Each developer logs in with their own role, such as:

```text
pierce_dev
aaron_dev
```

Flyway then runs:

```sql
SET ROLE gm_migrator;
```

through the shared `flyway.toml` config.

This means migrations are executed as `gm_migrator`, so schema objects are owned consistently by one shared migration role instead of by whichever developer happened to run the migration.

The normal access model is:

```text
developer login role -> SET ROLE gm_migrator -> run migrations
```

`gm_migrator` is a `NOLOGIN` role, so nobody connects directly as it.

### The Directus runtime role (`gm_directus`)

Once Directus is bootstrapped against a branch, a second service role exists: `gm_directus`.
This is a `LOGIN` role that the Directus container connects as. It is deliberately **not** part
of the developer migration flow:

* It **owns the `directus_*` system tables** it creates during bootstrap. This is the one place
  ownership is intentionally split: `gm_migrator` owns the application schema, `gm_directus` owns
  the Directus system schema.
* It holds only least-privilege grants on the application tables the custom endpoints actually
  query, not ownership and not DDL. It never runs Flyway migrations.
* Its credentials live only in the Directus repo's runtime environment (`.env`), never in `flyway.user.toml`.

`gm_directus` and its bootstrap-time grants are created by
`provisioning/02_directus_role_setup.sql`, run once per branch **before** Directus bootstraps
(Directus connects as `gm_directus`, so the role must exist first).

Because ownership is split, a second manual step is required **after** bootstrap: `gm_migrator`
must be able to add foreign keys pointing at the `gm_directus`-owned Directus tables, and
`gm_directus` needs its scoped read/write grants on the application tables the endpoints query.
Both are in `provisioning/03_directus_post_bootstrap_grants.sql`, which includes:

```sql
-- run as neondb_owner AFTER Directus bootstrap, BEFORE V004
GRANT REFERENCES ON directus_users, directus_files TO gm_migrator;
-- plus the least-privilege application-table grants for gm_directus
```

Do not put `gm_directus`, its grants, or the `REFERENCES` grant inside `migrations/`; they are
manual provisioning steps, the same as the developer roles.

Role setup is documented across the provisioning scripts:

```text
provisioning/01_dev_roles.sql                    gm_migrator + developer login roles
provisioning/02_directus_role_setup.sql          gm_directus + bootstrap grants (run before bootstrap)
provisioning/03_directus_post_bootstrap_grants.sql  REFERENCES + gm_directus app grants (run after bootstrap)
```

These are not Flyway migrations. They are one-time manual setup scripts run by the project owner as `neondb_owner`.

Do not put role creation, login creation, or real passwords in `migrations/`.

## Neon access vs database access

Neon project access and Postgres database access are separate.

Neon project access is used for control-plane work, such as:

* viewing branches
* creating branches
* resetting a personal branch from its parent
* copying branch connection details

Postgres database access is used for connecting to the database and running Flyway.

Normal Flyway work should still use a limited login role such as `pierce_dev` or `aaron_dev`, not `neondb_owner`.

Personal Neon branch have already been created. You do not need to create a branch as part of initial setup. You should
familiarize yourself with how to keep that branch up to date by resetting it from the shared development parent before testing new migrations.

## Personal Neon branches

Each developer has a personal Neon branch for testing migrations before they are merged and applied to shared development.

The current model is:

```text
development    shared development branch
pierce_dev     Pierce's personal testing branch
aaron_dev      Aaron's personal testing branch
```

The personal branch is a private copy of the shared development database. It lets you test a migration safely without touching the database everyone else relies on.

The committed `flyway.toml` includes a `personal` environment, but each developer's actual personal branch URL stays local in their git-ignored `flyway.user.toml`.

Add this to your local `flyway.user.toml`:

```toml
[environments.personal]
url = "jdbc:postgresql://YOUR_PERSONAL_BRANCH_HOST.neon.tech/neondb?sslmode=require"
user = "your_dev_login"
password = "your_dev_password"
```

Example for Pierce:

```toml
[environments.personal]
url = "jdbc:postgresql://YOUR_PIERCE_BRANCH_HOST.neon.tech/neondb?sslmode=require"
user = "pierce_dev"
password = "your-password"
```

Example for Aaron:

```toml
[environments.personal]
url = "jdbc:postgresql://YOUR_AARON_BRANCH_HOST.neon.tech/neondb?sslmode=require"
user = "aaron_dev"
password = "your-password"
```

Test your personal branch connection with:

```bash
flyway info -environment=personal
```

Apply test migrations to your personal branch with:

```bash
flyway migrate -environment=personal
```

The `SET ROLE gm_migrator` behavior for the personal environment is already defined in the shared `flyway.toml`, so objects created while testing should be owned by `gm_migrator`, the same as on shared development.

### Keeping your personal branch up to date

Before starting a new schema change, reset your personal branch from the shared development parent in the Neon console.

For example:

```text
development -> pierce_dev
development -> aaron_dev
```

Resetting from parent refreshes your personal branch to match the current shared development branch.

This is a destructive refresh of the personal branch. Any test-only changes on your personal branch are discarded. That is expected.

Do not use `flyway clean` to refresh a branch. `clean` is disabled in Flyway config and should stay disabled.

Typical reset workflow:

```text
1. Make sure shared development is up to date.
2. Reset your personal Neon branch from the development parent.
3. Pull latest main locally.
4. Create a Git branch.
5. Add and test your migration on your personal branch.
```

## Migration ordering and the Directus bootstrap boundary

This is the one place the "reset branch, then migrate" workflow is not a straight line, and it
will fail confusingly if you skip it.

The migration set is split across a Directus bootstrap boundary:

```text
V001 – V003   pre-bootstrap    plain application schema, no Directus dependency
--- Directus bootstrap happens here ---
V004 – V005   post-bootstrap   reference directus_users / directus_files
```

V004 begins with a guard that raises a clear error if the Directus system tables are missing, so a
straight `flyway migrate` on a branch that has not bootstrapped Directus will stop at V004 with a
message telling you to bootstrap first. That is expected, not a bug.

To bring a **fresh** branch (for example after resetting your personal branch) to the full current
schema, the order interleaves the two subprojects. Directory in brackets:

```text
1. [db]       flyway migrate -environment=personal -target=003_20260623141647   (through last pre-bootstrap)
2. [db]       run provisioning/02_directus_role_setup.sql as neondb_owner        (creates gm_directus; role must exist before bootstrap)
3. [directus] docker compose run --rm directus bootstrap && docker compose up -d (creates directus_* system tables)
4. [db]       run provisioning/03_directus_post_bootstrap_grants.sql as neondb_owner (REFERENCES + gm_directus app grants)
5. [db]       flyway migrate -environment=personal                                (applies V004 and V005)
```

If you are only testing a **new** pre-bootstrap migration and your branch already has Directus
bootstrapped (or you are not touching V004+), a plain `flyway migrate -environment=personal` is
fine. The boundary only matters when a branch has the post-bootstrap migrations pending but no
Directus system tables yet.

Note on shared `development`: confirm whether `development` has itself been bootstrapped and taken
V004/V005 before assuming a reset personal branch will migrate cleanly. A personal branch inherits
whatever state `development` is in at reset time.

## Getting Directus running (`gathering-matters-directus/`)

This is the runtime side of the fresh-branch sequence above. It assumes the branch already has
V001–V003 applied and `gm_directus` created (steps 1–2).

Prerequisites: Docker Desktop, and Node.js (to build the extensions).

### 1. Configure the runtime environment

```text
DIRECTORY: gathering-matters-directus
```

```bash
cp .env.example .env        # (PowerShell: Copy-Item .env.example .env)
```

Fill in `.env`. The decisions that matter, beyond the values `.env.example` lists:

* `DB_USER=gm_directus` and the **direct** Neon endpoint (not `-pooler`), `DB_SSL=true`. Directus
  holds session state that Neon's transaction-mode pooler can break, and bootstrap is DDL.
* Generate `KEY` and `SECRET` (two independent random values). PowerShell:
  `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))` run twice.
* Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` so bootstrap creates the first admin non-interactively.
* Leave `LICENSE_KEY` **empty** on local/personal branches. The OIG license binds to `PUBLIC_URL`
  on first use, so it is reserved for the durable staging instance, not a resettable branch.
* Extension secrets (`GM_SEARCH_CURSOR_SECRET`, `GM_RISK_HASH_SECRET`, `GM_SUBMISSION_CONSENT_VERSION`,
  `GM_CONTACT_CONSENT_VERSION`) can stay unset for a first bootstrap; set them before exercising the
  endpoints. Leave `GM_PROMOTION_ROLE_IDS` unset until the role matrix exists on staging; the
  promotion operation safely refuses without it.

Never commit `.env`.

### 2. Bootstrap Directus

```text
DIRECTORY: gathering-matters-directus
```

```bash
docker compose run --rm directus bootstrap
docker compose up -d
docker compose logs -f directus
```

`bootstrap` creates the `directus_*` system tables (owned by `gm_directus`) and the first admin.
The Studio is then at `http://localhost:8055`. The repeated `Could not set primary key ... unknown
table` lines for the application tables are expected and harmless: Directus is declining to manage
tables it hasn't been told are collections.

After bootstrap, return to step 4 of the boundary sequence (run
`03_directus_post_bootstrap_grants.sql`), then step 5 (`flyway migrate` for V004/V005).

### 3. Build and mount the extensions

The three extensions live in `extensions-src/`. Build each, then stage `package.json` + `dist/`
into the Docker-mounted extensions directory as a folder named `directus-extension-<name>` (Directus
only loads folders with that prefix). Built artifacts are git ignored and regenerated; the committed
`package-lock.json` files pin the toolchain for reproducible installs (`npm ci` uses them).

```text
DIRECTORY: gathering-matters-directus/extensions-src/<name>
```

```bash
npm ci            # or: npm install (uses the committed package-lock.json)
npm run build     # produces dist/
```

**Required for `gm-intake` and `promote-submission`:** both import from `@directus/errors`. Directus
provides that package at runtime, but the bundler must resolve it at build time, so it has to be an
exact-version dev dependency. In each of those two folders:

```bash
npm install --save-dev --save-exact @directus/errors
```

`gm-library` does not import `@directus/errors` and does not need this. The `package-lock.json` files
capture the dependency, so a clean `npm ci` restores it; the explicit install is only needed when
setting a folder up from scratch.

Stage the built output into the mounted directory (PowerShell example for one extension):

```powershell
New-Item -ItemType Directory -Force -Path ..\..\extensions\directus-extension-gm-library | Out-Null
Copy-Item package.json ..\..\extensions\directus-extension-gm-library\ -Force
Copy-Item dist          ..\..\extensions\directus-extension-gm-library\ -Recurse -Force
```

Repeat for `gm-intake` and `promote-submission`. Confirm `docker-compose.yml` mounts `./extensions`
to `/directus/extensions`, and set `EXTENSIONS_MUST_LOAD=true` in `.env` so a failed extension makes
Directus exit loudly instead of starting half-broken.

### 4. Restart and verify the load

```text
DIRECTORY: gathering-matters-directus
```

```bash
docker compose up -d --force-recreate
docker compose logs -f directus
```

The container staying up (with `EXTENSIONS_MUST_LOAD=true`) means all three loaded. Then probe:

```powershell
curl.exe -i http://localhost:8055/gm-library/search
```

* `500 {"error":"search_unavailable"}` means the route loaded and hit its cursor-secret guard
  (expected when `GM_SEARCH_CURSOR_SECRET` is unset).
* `200` with an empty feed means the route loaded and the secret is set.
* `404` means the extension did not load. Check the logs for the named failure.

## Daily commands

Run these from `gathering-matters-db/`.

Check migration status on shared development:

```bash
flyway info
```

Validate migration files against shared development:

```bash
flyway validate
```

Apply pending migrations to shared development:

```bash
flyway migrate
```

Because `development` is the default environment, a bare command targets shared development.

To target your personal Neon branch, add:

```bash
-environment=personal
```

Examples:

```bash
flyway info -environment=personal
flyway validate -environment=personal
flyway migrate -environment=personal
```

For normal onboarding, new developers should start with:

```bash
flyway info
flyway validate
```

Do not run `flyway migrate` against the shared development database until the team is ready to apply pending migrations from `main`.

## Repair command

`flyway repair` exists, but it is **not** part of the normal workflow.

Use it only when Flyway's schema history table needs to be repaired, such as after a failed migration attempt or after a maintainer has intentionally resolved a checksum mismatch.

```bash
flyway repair
```

Important:

* Do not use `repair` to casually bypass Flyway errors.
* Do not use `repair` because you edited an already-applied migration and want Flyway to stop complaining.
* Do not run `repair` on a shared database unless the team understands why it is needed.
* `repair` changes Flyway's migration history metadata. It does not fix the actual database schema.

Normal fix for a bad applied migration:

```text
Create a new migration that corrects the problem.
```

Use `repair` only when the migration history table itself is the problem.

## Creating a migration

Use `flyway add` to create a new migration file:

```bash
flyway add -description=add_content_items
```

Then open the generated file in `migrations/`, write the SQL, and save it.

Migration files follow this format:

```text
V<version>__<description>.sql
```

This repo uses an ordinal-plus-timestamp version so files sort deterministically and read clearly:

```text
V004_20260629194749__directus_relations_privacy_audit_files.sql
```

`flyway add` generates a bare-timestamp version; keep the repo's ordinal prefix convention when you
name the file (the next migration would be `V006_<timestamp>__...`).

Rules:

* Use one migration per logical schema change.
* Do not edit a migration after it has been applied to a shared database.
* If something needs to change, create a new migration.
* Do not create undo migrations. Flyway Community does not support them.

You may edit a migration while testing locally on your personal Neon branch, as long as that migration has not been applied to a shared database. If you need a clean retest, reset your personal Neon branch from the shared development parent and run the migration again.

## Verifying a migration

After running:

```bash
flyway migrate
```

or:

```bash
flyway migrate -environment=personal
```

open the database in your preferred PostgreSQL client and confirm:

* the expected tables and columns exist
* `flyway_schema_history` has a successful row for the migration
* new schema objects are owned by `gm_migrator`

You can check table ownership with:

```sql
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public';
```

You can use any PostgreSQL client, such as DataGrip, DBeaver, TablePlus, pgAdmin, or `psql`.

Database clients are fine for browsing, querying, and drafting SQL. Do not apply structural schema changes directly through a client unless the same change is captured in a Flyway migration file.

## Team workflow

Use this workflow for schema changes.

### 1. Start from the latest `main`

```bash
git switch main
git pull
```

### 2. Refresh your personal Neon branch

In Neon, reset your personal branch from the shared `development` parent.

This gives you a clean copy of the current shared development database before testing a new migration.

### 3. Create a Git branch

```bash
git switch -c feature/add-content-items
```

### 4. Create a migration

```bash
flyway add -description=add_content_items
```

Then write the SQL in the generated file under `migrations/`.

### 5. Test on your personal Neon branch

```bash
flyway info -environment=personal
flyway validate -environment=personal
flyway migrate -environment=personal
flyway info -environment=personal
```

Confirm the migration shows as successful and verify the schema in your PostgreSQL client if needed.

### 6. Commit and push

```bash
git add migrations/
git commit -m "Add content items"
git push -u origin feature/add-content-items
```

### 7. Open a pull request

Open a GitHub pull request and get one review.

Do not apply the migration to shared development before the pull request is merged.

(Or if confident you can just merge yourself)
### 8. Merge to `main`

After review, merge the pull request into `main`.

### 9. Apply merged migrations to shared development

From `main`:

```bash
git switch main
git pull
flyway info
flyway validate
flyway migrate
flyway info
```

Only migrations merged to `main` should be applied to the shared development database.

## Important rules

### Keep secrets out of Git

Never commit:

```text
flyway.user.toml
flyway.user.toml.superuser
.env
*.env
```

Real database passwords should be shared through a password manager or another secure channel, never through Git.

### Never edit applied migrations on shared databases

Flyway stores a checksum for each applied migration. If an applied migration file changes, Flyway will detect it and stop.

Fix mistakes on shared databases with a new migration.

### Personal branches are for testing

Personal Neon branches are disposable testing copies.

It is fine to reset them from the shared development parent. It is also fine to test a migration there, find a problem, reset the branch, edit the migration, and test again.

Do not treat a personal branch as the source of truth.

### Shared development is migrated only from `main`

Never apply an unmerged migration to shared development.

The safe sequence is:

```text
personal branch -> PR -> merge to main -> shared development
```
If you do it can prevent other migrations from ocurring as a validation error will occur. 
### Fix forward

Flyway Community does not support undo migrations. If a migration needs to be corrected after it has been applied to a shared database, write a new migration that reverses or amends the previous one.

### Keep role setup out of migrations

Do not create login roles, passwords, or administrative grants in Flyway migration files.

Role setup belongs in `provisioning/` as a manual admin script.

### Keep structure SQL-first

Engineers change database structure through Flyway migrations:

* tables
* columns
* constraints
* indexes
* foreign keys
* database functions/triggers

When Directus is added later, it can manage content and editor/admin configuration, but structural schema changes should still go through Flyway.

Directus is now bootstrapped (see the setup notes above), so this boundary is live, not
hypothetical: Directus owns its own system tables and, later, content and editor/admin
configuration, but it must never be used to alter the application schema. Every table, column,
constraint, index, foreign key, function, and trigger in the application schema stays Flyway-owned
and SQL-first. If a change shows up in Directus's data-model tools that isn't captured in a
migration, that is drift to correct, not a shortcut to take.

## Notes on Flyway configuration

The shared `flyway.toml` config sets the default development environment and points Flyway at the `migrations/` folder.

It also sets:

```toml
initSql = "SET ROLE gm_migrator"
```

for both the shared development environment and the personal environment.

This makes Flyway run migrations as the shared `gm_migrator` role after connecting with each developer's personal login role.

`initSql` is currently used for simplicity. If Flyway removes it in a future version, this can move to an `afterConnect.sql` callback in a scanned location.

## Production

Production is not configured yet.

When production exists, it should use:

* a separate Neon database/project/branch
* separate production credentials
* a separate `[environments.production]` block in `flyway.toml`
* explicit production deploy commands from `main`

Do not give normal developers production credentials by default.