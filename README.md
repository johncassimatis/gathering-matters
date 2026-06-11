# Gathering Matters Database

Schema for the Gathering Matters database, managed with Flyway Community against
hosted PostgreSQL on Neon. All schema changes are SQL migration files under
version control. This repository is the source of truth for the database
structure.

Development only for now. Production is added later, when there is something to
deploy.

## What is in this repository

```
gathering-matters-database/
├─ flyway.toml                 committed, shared config, no secrets
├─ flyway.user.toml.example    committed template for your local secrets
├─ flyway.user.toml            git ignored, your personal Neon credentials
├─ .gitignore
├─ README.md                   this file
└─ migrations/                 every schema change lives here
   └─ V20260610143000__create_initial_schema.sql
```

Migration files live in `migrations/` and nowhere else. Flyway is pointed at
that folder by the `locations` setting in `flyway.toml`.

## One time setup

### 1. Install the Flyway CLI

For a one or two person team, install the CLI locally. It bundles its own Java
runtime, so there is nothing else to install.

- macOS: `brew install flyway`
- Or download the command line tool from the Flyway site and add it to your PATH.

Pin the version so everyone runs the same one. As of this writing that is
Flyway 12.7.0. Confirm yours with `flyway -v`. When you later add CI, switch to
the pinned `flyway/flyway` Docker image so local and CI always match. You do not
need Docker yet.

### 2. Add your credentials

Each developer has their own Neon database role, so credentials are personal and
never committed.

```
cp flyway.user.toml.example flyway.user.toml
```

Open `flyway.user.toml` and fill in your Neon user and password. This file is
git ignored. The shared host and engine settings are already in `flyway.toml`,
so your user file only needs the parts that are yours.

Get the connection details from the Neon dashboard. Use the direct (non pooled)
connection string for Flyway, not the `-pooler` endpoint. Neon requires SSL, so
the URL in `flyway.toml` already ends with `?sslmode=require`.

### 3. Point the host at your Neon project

In `flyway.toml`, replace `YOUR_DEV_HOST` with your actual Neon development
endpoint. Start from an empty database so your migration files and the database
agree from the first run.

## Creating a migration

Do not name files by hand. Use `flyway add`, which generates the timestamped
file name for you:

```
flyway add -description="create initial schema"
```

This creates an empty file in `migrations/` named like
`V20260610143000__create_initial_schema.sql`. The timestamp is generated
automatically because `flyway.toml` sets `[flyway.add] timestamp = "always"`.
Open the new file, write your SQL, and save.

Because the version is a timestamp, two people adding migrations on the same day
never collide on a version number.

## Daily commands

Run these from the repository root. Development is the only environment and the
default, so a bare command always targets it.

```
flyway info        # what is applied and what is pending, run this first
flyway validate    # confirm no applied migration has been changed
flyway migrate     # apply pending migrations
```

`migrate` runs `validate` automatically, but running `info` and `validate`
yourself first is good habit. `migrate` is safe to run repeatedly; it only
applies what is pending.

## Verifying a migration in DataGrip

After `flyway migrate` reports success:

1. In DataGrip, refresh the database tree.
2. Confirm the new tables and columns are present.
3. Open the `flyway_schema_history` table. Flyway creates and maintains this
   automatically. Each applied migration has a row with its version,
   description, checksum, install time, and a `success` flag. This table is the
   record of what is applied, and it is the same information `flyway info`
   prints.

Keep using DataGrip for browsing, querying, and drafting SQL. Just do not apply
schema changes through it directly. Draft the SQL, move it into a migration file
(via `flyway add`), and let Flyway apply it.

## Migration naming

`flyway add` handles this for you, but for reference the convention is:

```
V<timestamp>__<description>.sql
```

Example: `V20260610143000__create_initial_schema.sql`

- `V` marks a versioned migration.
- The version is a UTC timestamp, `YYYYMMDDHHMMSS`. `flyway add` generates it.
- Two underscores separate the version from the description.
- The description comes from the `-description` you pass to `flyway add`.

You do not need a separate migration framework. Flyway plus these plain SQL
files is the framework.

## Do you need baseline?

No, not while the database is empty. On an empty database, `flyway migrate`
creates the `flyway_schema_history` table itself and applies your migrations
from the start. `baseline` exists only for adopting an existing, non empty
database that Flyway did not create. If your development database already has
experimental tables from earlier DataGrip work, start clean instead: create a
fresh empty database and run `migrate` against that.

## Team workflow rules

These are the rules that keep the history trustworthy as the team grows.

1. Never edit a migration that has been applied. Flyway stores a checksum of
   every applied file and refuses to migrate if one changes. If you need to
   alter something already applied, write a new migration instead.

2. Fix forward. Flyway Community has no `undo` command (it is a paid feature), so
   a mistake is corrected by a new migration that reverses or amends the
   previous one, not by rolling back.

3. One logical change per migration. A migration should do one coherent thing,
   for example create one table or add one set of related columns. Small
   migrations are easier to review and easier to reason about when something
   goes wrong.

4. Review through GitHub pull requests. Create a branch, run `flyway add`, write
   your SQL, open a PR, get one review, then merge to `main`.

5. Test on your own database, apply the shared one from `main`. Test a new
   migration against your own Neon branch or a throwaway database first. Only
   migrations merged to `main` get applied to the shared development database.
   This keeps half finished work off the database everyone relies on.

6. Structure changes go through Flyway, content changes go through the tool.
   When Directus is added later, engineers make structural changes (tables,
   columns, constraints) as Flyway migrations, and staff make content shaped
   changes in the Directus interface. Flyway will not police this for you on the
   free tier, so it is a shared discipline.

## What to ignore from Flyway Desktop and paid Redgate features

This is a command line, migrations only workflow. You can ignore everything tied
to the Desktop GUI and the comparison engine:

- The `flywayDesktop` and `redgateCompare` sections of the TOML config.
- The `schema-model/` folder and any `.scpf` filter files, if a tool ever
  creates them. They are git ignored already.
- The comparison and deployment commands: `diff`, `generate`, `model`,
  `prepare`, `deploy`, `snapshot`, `check drift`, and `check dryrun`. These are
  Teams or Enterprise features.
- The `undo` command, which is also paid. Fix forward instead.
- Cloud secret manager resolvers (AWS, GCP, Vault). The git ignored
  `flyway.user.toml` is enough for now.

## Adding production later

When you are ready to deploy:

1. Create the production database (a separate Neon project, or a branch).
2. Add an `[environments.production]` block to `flyway.toml` with its direct URL.
3. The person who deploys adds a matching `[environments.production]` block with
   `user` and `password` to their own `flyway.user.toml`. Other developers do
   not get production credentials.
4. Deploy from `main` only, targeting it explicitly:
   `flyway migrate -environment=production`.

Other likely next steps, when you need them: a repeatable migration
(`R__name.sql`) for reference data and views, a Neon branch per developer for
isolated testing, and the pinned `flyway/flyway` Docker image plus environment
variable resolvers once you set up CI.
