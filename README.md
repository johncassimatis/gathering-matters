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
* Testing workflow: personal Neon branches before shared development

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
   └─ V...__create_initial_schema.sql
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

The role setup is documented in:

```text
provisioning/01_dev_roles.sql
```

This file is not a Flyway migration. It is a one-time manual setup script run by the project owner as `neondb_owner`.

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

## Daily commands

Run these from the repository root.

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

Example:

```text
V20260611103000__add_content_items.sql
```

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
