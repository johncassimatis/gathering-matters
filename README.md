# Gathering Matters Database

> This README was drafted with ChatGPT and vetted by the project maintainer. It is project onboarding guidance for this repository, not a replacement for official Flyway or Neon documentation.

PostgreSQL schema and Flyway migrations for the Gathering Matters database.

This repository is the source of truth for database structure. Structural database changes should be made through SQL migration files in `migrations/`, not manually through a database client.

Current setup:

* Database: Neon PostgreSQL
* Development database: `neondb`
* Postgres version: 18
* Migration tool: Flyway Community Edition 12.8.2-rc2175
* Workflow: SQL-first migrations reviewed through GitHub

Production is not set up yet. This repository is development-only for now.

## Repository structure

```text
gathering-matters-database/
├─ flyway.toml                 shared Flyway config, no secrets
├─ flyway.user.toml.example    template for local credentials
├─ flyway.user.toml            local credentials, git ignored
├─ .gitignore
├─ README.md
├─ provisioning/               one-time manual role setup, not Flyway migrations
│  └─ 01_dev_roles.sql
└─ migrations/
   └─ V001_20260610225550__create_initial_schema.sql
```

Migration files live in `migrations/`.

Role and access setup scripts live in `provisioning/`. These are manual administrative scripts and are not run by Flyway.

## One-time setup

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
git clone https://github.com/pierce-dfg/gathering-matters-database.git
cd gathering-matters-database
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

### 4. Confirm the database URL

The shared development database URL lives in `flyway.toml`.

Use the Neon direct endpoint, not the `-pooler` endpoint. Flyway migrations need a persistent database session.

The URL format is:

```text
jdbc:postgresql://<neon-host>/neondb?sslmode=require
```

The shared URL belongs in `flyway.toml`. Personal usernames and passwords belong only in `flyway.user.toml`.

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

The role setup is documented in:

```text
provisioning/01_dev_roles.sql
```

This file is not a Flyway migration. It is a one-time manual setup script run by the project owner as `neondb_owner`.

Do not put role creation, login creation, or real passwords in `migrations/`.

## Daily commands

Run these from the repository root.

Check migration status:

```bash
flyway info
```

Validate migration files:

```bash
flyway validate
```

Apply pending migrations:

```bash
flyway migrate
```

`flyway migrate` creates and updates the `flyway_schema_history` table automatically.

For normal onboarding, new developers should start with:

```bash
flyway info
flyway validate
```

Do not run `flyway migrate` against the shared development database until the team is ready to apply the pending migrations.

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

Example:

```text
V002_20260611103000__add_content_items.sql
```

Rules:

* Use one migration per logical schema change.
* Do not edit a migration after it has been applied.
* If something needs to change, create a new migration.
* Do not create undo migrations. Flyway Community does not support them.

## Verifying a migration

After running:

```bash
flyway migrate
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

1. Create a branch.
2. Create a migration with `flyway add`.
3. Write the SQL.
4. Test the migration.
5. Run:

```bash
flyway info
flyway validate
flyway migrate
```

6. Open a GitHub pull request.
7. Get one review.
8. Merge to `main`.

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

### Never edit applied migrations

Flyway stores a checksum for each applied migration. If an applied migration file changes, Flyway will detect it and stop.

Fix mistakes with a new migration.

### Fix forward

Flyway Community does not support undo migrations. If a migration needs to be corrected, write a new migration that reverses or amends the previous one.

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

## Notes on Flyway configuration

The shared `flyway.toml` config sets the development environment and points Flyway at the `migrations/` folder.

It also sets:

```toml
initSql = "SET ROLE gm_migrator"
```

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
