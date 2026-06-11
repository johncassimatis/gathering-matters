# Gathering Matters Database

> This README was drafted with ChatGPT and vetted by the project maintainer. It is project onboarding guidance for this repository, not a replacement for official Flyway or Neon documentation.

PostgreSQL schema and Flyway migrations for the Gathering Matters database.

This repository is the source of truth for database structure. Structural database changes should be made through SQL migration files in `migrations/`, not manually through a database client.

Current setup:

* Database: Neon PostgreSQL
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
└─ migrations/
   └─ V001_20260610225550__create_initial_schema.sql
```

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

Then fill in your Neon username and password in `flyway.user.toml`.

Do not commit `flyway.user.toml`.

### 4. Confirm the database URL

The shared development database URL lives in `flyway.toml`.

Use the Neon direct endpoint, not the `-pooler` endpoint. Flyway migrations need a persistent database session.

The URL format is:

```text
jdbc:postgresql://<neon-host>/<database>?sslmode=require&channel_binding=require
```

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
.env
*.env
```

### Never edit applied migrations

Flyway stores a checksum for each applied migration. If an applied migration file changes, Flyway will detect it and stop.

Fix mistakes with a new migration.

### Fix forward

Flyway Community does not support undo migrations. If a migration needs to be corrected, write a new migration that reverses or amends the previous one.

### Keep structure SQL-first

Engineers change database structure through Flyway migrations:

* tables
* columns
* constraints
* indexes
* foreign keys
* database functions/triggers

When Directus is added later, it can manage content and editor/admin configuration, but structural schema changes should still go through Flyway.
