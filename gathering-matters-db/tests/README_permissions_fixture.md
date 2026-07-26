# Permissions validation fixture

Two surgically-removable SQL fixtures for validating a Directus role/permission
model (Contributor / Editor / Moderator / Publisher) on the Neon branch:

- [`seed_permissions_fixture.sql`](seed_permissions_fixture.sql) — inserts the boundary rows.
- [`teardown_permissions_fixture.sql`](teardown_permissions_fixture.sql) — removes **only** those rows, idempotently.

Every removable row carries a marker: `TESTSEED_` in a human column
(content title / content_type name / tag name) or the fake email domain
`@testseed.invalid` (submissions). Teardown keys only on those markers, so it
cannot touch production data. All submitter PII is fake. **This is a youth org —
never put real or real-looking minor data in these files.**

## The seed is INERT until three accounts exist

The seed references three real `directus_users` ids as psql placeholders:

| Placeholder     | Account                                | Used for                                  |
|-----------------|----------------------------------------|-------------------------------------------|
| `:vol1_id`      | test-volunteer 1 (Contributor)         | `content_item.user_created` (draft b)     |
| `:vol2_id`      | test-volunteer 2 (Contributor)         | `content_item.user_created` (draft c)     |
| `:reviewer_id`  | a privileged reviewer (Admin/Publisher)| `content_item.privacy_reviewed_by` (a, e) |

`:reviewer_id` is **not optional**. Migration V004 requires every `published`
`content_item` to have `privacy_reviewed_at` set, paired with a
`privacy_reviewed_by` that is a real user (`FK ... ON DELETE RESTRICT`). Use the
Admin account id if no Publisher exists yet.

None of these accounts exist at the time of writing (only the Admin **role**
exists; Contributor/Editor/Moderator/Publisher roles and the two volunteer
accounts are not created yet). Until they exist the seed will not run — its
preflight aborts with a clear message and rolls back, and the FK constraints
would reject the inserts regardless.

## Full sequence (do these in order)

1. **Build the Contributor role + policies** in Directus (then Editor / Moderator
   / Publisher as you get to them).
2. **Create two test-volunteer accounts**, assign each the Contributor role, and
   copy their `directus_users.id` values → these become `:vol1_id`, `:vol2_id`.
3. **Pick a reviewer account** (Admin now, Publisher later) and copy its id →
   `:reviewer_id`.
4. **Run the seed**, substituting the three ids (see command below).
5. **Run adversarial tests** for each role (draft ownership isolation, published
   vs. future-dated visibility, `editorial_notes` / `moderation_notes` /
   submitter-PII field hiding, submission read-denial, etc.).
6. **Tear down** when done.

### Run the seed (psql)

```bash
psql "$YOUR_CONNECTION_STRING" \
  -v vol1_id=<uuid-of-test-volunteer-1> \
  -v vol2_id=<uuid-of-test-volunteer-2> \
  -v reviewer_id=<uuid-of-reviewer-or-admin> \
  -f tests/seed_permissions_fixture.sql
```

Pass the ids **raw** (no surrounding quotes). The script's `:'name'::uuid`
references wrap each value in quotes for you, producing a quoted uuid string cast
to `uuid`. **Non-psql clients (DataGrip):** replace the three `:'vol1_id'`,
`:'vol2_id'`, `:'reviewer_id'` tokens with quoted uuid literals (e.g.
`'0190a...'::uuid`) before running.

The seed is **not** idempotent (unique slugs/names). To re-seed, run teardown
first.

### Tear down (exact command)

```bash
psql "$YOUR_CONNECTION_STRING" -f tests/teardown_permissions_fixture.sql
```

Teardown takes **no** variables, is **idempotent** (safe to run twice), deletes
in FK-safe order (junctions → content_item → submission → tag → content_type),
and **does not** delete the `directus_users` accounts you created by hand.

## What the seed contains

- **1 content_type**: `TESTSEED_Story` (`testseed-story`).
- **4 tags** across all three dimensions, including one inactive:
  `topic` (active), `audience` (active), `region` (active), `topic` (inactive).
- **5 content_item rows**:
  - (a) published + privacy-reviewed + **past** `published_at` → visible; also
    carries `editorial_notes` + privacy fields for field-hiding tests on a
    visible row.
  - (b) draft owned by `:vol1_id`.
  - (c) draft owned by `:vol2_id`.
  - (d) archived.
  - (e) published + **future** `published_at` → must be hidden by a
    `published_at <= now()` filter.
- **content_item_tag** junctions on (a) (incl. the inactive tag) and (b).
- **2 submission rows** with fake PII: a `draft` (consent = false) and a
  `pending` (full consent + contact consent + `moderation_notes`).

## audit-event caveat

`audit_event` is **not** seeded. Its append-only trigger (V005) rejects
`UPDATE`/`DELETE`/`TRUNCATE`, so a seeded audit row could never be cleanly
removed from the branch. **Audit read-denial is validated against a real
promotion instead** — promote a submission through the normal workflow so a
genuine `audit_event` row is written, then assert that non-privileged roles
cannot read it.

Important: `audit_event` references `submission` and `content_item` with
`ON DELETE RESTRICT`. Do **not** run that real promotion against these removable
TESTSEED rows — once an audit row points at a content_item/submission, teardown
can no longer delete it. Use disposable data (or a throwaway branch) you are
willing to keep for the promotion/audit test.

## Row counts (needed, not gathered)

I did **not** connect to the production Neon branch to read live counts (this
task and standing guidance forbid touching production / reading `.env` secrets).
Please capture the pre-seed counts yourself so you can confirm the seed added
exactly the expected rows and teardown returned to baseline:

```sql
SELECT 'content_type' AS tbl, count(*) FROM content_type
UNION ALL SELECT 'content_item', count(*) FROM content_item
UNION ALL SELECT 'submission',   count(*) FROM submission
UNION ALL SELECT 'tag',          count(*) FROM tag;
```

Expected deltas from the seed: `content_type +1`, `tag +4`, `content_item +5`,
`submission +2` (plus 4 `content_item_tag` junctions). Teardown should return all
four to their pre-seed values.
