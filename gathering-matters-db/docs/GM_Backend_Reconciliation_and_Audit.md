# Gathering Matters Backend: Reconciliation and Implementation Audit

Date: 2026-06-23. Prepared for handoff to Team and the GM team.

## 0. Source-of-truth caveat (read first)

This audit was asked to treat the actual repository, Flyway history, and live Directus/Neon environment as the source of truth. Those files were not available in this working session. The only inputs present were the two deep-research reports and the prior design artifacts. Therefore the "actual state" assessed below is reconstructed from the iterated design in the project record, not from a verified git checkout or a real `flyway_schema_history` table.

Consequence for every migration decision: I cannot confirm whether V2 (or any migration) has actually been applied in a shared environment. I have followed the forward-only rule by default. Where I propose editing V2 itself rather than adding a forward migration, I say so explicitly and gate it on "only if V2 is confirmed never-applied outside local." Team must reconcile the version numbers below against the real repository before running anything.

Files delivered alongside this document (all under `gm-backend/`):

```
sql/V20260623150000__keyset_indexes_placement_risk_event.sql   (pre-bootstrap, forward)
sql/V20260623160000__directus_relations_privacy_audit_files.sql (post-bootstrap, forward)
sql/V20260623161000__audit_event_immutable.sql                 (post-bootstrap, forward)
extensions/operations/promote-submission/api.js          (final)
extensions/operations/promote-submission/app.js          (final)
extensions/endpoints/gm-library/index.js                 (search + detail, keyset)
extensions/endpoints/gm-intake/index.js                  (public submission)
test/seed_10k.sql  test/explain_checks.sql  test/verification.sql  test/http_tests.sh  test/promote_concurrency.sh
```

V2 itself (`content_type`, `tag` alterations, `content_item`, `submission`, junctions, base indexes) is treated as the frozen baseline from the project record and is NOT reproduced here. Two pre-production edits it still needs are listed in section 3.

---

## 1. Reconciliation table: research vs actual vs final decision

| Topic | Research reports recommend | Reconstructed actual state | Final decision | Where |
|---|---|---|---|---|
| Neon / PG18 | Prefer PG17 if risk-averse; PG18 "preview" | V2 uses native `uuidv7()` | Keep PG18. Verified: Neon made PG18 GA on 2026-05-01 and default on 2026-06-05, so the preview caution is stale. `io_method=sync` is a perf nuance only. | runbook |
| Curated outputs (Idea Generator) | Report 1: `show_in_idea_generator` boolean. Report 2: same family. | Not present | **`content_placement` table** (general), not a boolean. Diverges from report on purpose: the prompt elevates a placement table, it avoids overloading `featured`, and it lets the client add curated surfaces with no migration. | V20260623150000 |
| Audit events | Report 1: append-only, application-controlled. Report 2: DB-enforced via narrow trigger. | Not present | **DB-enforced immutability via triggers on UPDATE, DELETE, AND TRUNCATE.** Picks report 2's stronger option. Scope stated honestly: immutable against ordinary app DML, not against a DB owner who can drop the triggers. | V20260623160000 + V20260623161000 |
| Keyset pagination | Signed cursor with `as_of`, `filters_hash`, HMAC sig | Endpoint used offset pagination | Adopt signed keyset cursor with `as_of`. Offset removed from the public contract. | gm-library |
| Public detail reads | `/gm-library/items/:slug` custom endpoint, OR public collection read with `$NOW` filter | Not present | **Custom `/gm-library/items/:slug` endpoint** enforcing `published AND published_at<=now()`, fixed projection. Avoids relying on Directus public collection read. | gm-library |
| Public submission intake | Custom `POST` endpoint, no public collection create, honeypot, hashed-IP risk telemetry | Not present | Adopt as `POST /gm-intake/submissions` + `risk_event` table. Reconciled to V2's frozen consent columns; report's dedupe-by-`digest()` bug fixed (fingerprint lookup in `risk_event`). | gm-intake, V20260623150000 |
| Contributor model | Defer; `author` stays free-text byline | `author` free text in V2 | Defer. Add `contributor` + junction only when reusable contributor pages or contributor filters are a real requirement. | n/a (deferred) |
| Related content | Defer; derive from shared tags/type | Not present | Defer. Add `content_item_relation` self-junction only if editors need fixed (non-derived) related cards. | n/a (deferred) |
| Feed index shape | Add `id` tie-breaker for keyset | V2 feed indexes lacked `id` | Re-create feed indexes as `(published_at DESC, id DESC)` and `(content_type_id, published_at DESC, id DESC)`. | V20260623150000 |
| `reviewed_by`/`promoted_by`/`privacy_reviewed_by` FK action | RESTRICT (preserve accountability) | My earlier draft used SET NULL on some | Accountability columns RESTRICT; authorship columns (`user_created`/`user_updated`) SET NULL. | V20260623160000 |
| Search/index strategy | Keep PG-native FTS (stored tsvector, GIN, partial feeds, EXISTS). No trigram/MV/external/vector yet | Matches | Keep. No premature additions. | V2 + V20260623150000 |

---

## 2. File inventory and migration-history assessment

| Migration / file | Pre or post bootstrap | Applied? (must verify) | Forward-only? | Notes |
|---|---|---|---|---|
| V2 `__add_content_submissions_and_types.sql` | pre | unknown | baseline | Frozen. Needs two pre-production edits (section 3) IF and only IF confirmed never-applied. |
| V20260623150000 `__keyset_indexes_placement_riskevent.sql` | pre | new | yes | `DROP INDEX IF EXISTS` makes the feed-index swap safe whether or not V2 ran. Adds `content_placement`, `risk_event`. |
| V20260623160000 `__directus_relations_privacy_audit_files.sql` | post | new | yes | Guarded with a `DO` block that raises if `directus_users`/`directus_files` are absent. |
| V20260623161000 `__audit_event_immutable.sql` | post | new | yes | Trigger making `audit_event` append-only. |
| promote-submission op | extension | new/final | n/a | Requires V20260623160000 columns + `audit_event`. Deploy only after V20260623160000(+a). |
| gm-library endpoint | extension | new/final | n/a | Independent of bootstrap; needs `GM_SEARCH_CURSOR_SECRET`. |
| gm-intake endpoint | extension | new/final | n/a | Needs `risk_event` (V20260623150000) + `GM_RISK_HASH_SECRET`. |

Migration ordering is the dependency that bites: V20260623160000 references Directus system tables, so it must run after the first Directus boot, and the promotion operation references columns V20260623160000 adds, so it must deploy after V20260623160000. The guard block turns a wrong order into a clear error rather than a silent partial apply.

---

## 3. Required audit matrix (filled)

P = present, A = added in this pass, F = fix applied, D = deliberately deferred.

| Requirement | File/location | Present? | Correct? | Action |
|---|---|---|---|---|
| Canonical `content_item` | V2 | P | yes | none |
| Private `submission` | V2 | P | yes | none |
| One-to-one submission to promoted content link | V2 `uq_submission_content_item` + state check | P | yes | none |
| Promoted requires link + `promoted_at` + `promoted_by` | V2 state check + V20260623160000 audit checks | partial | now yes | A (V20260623160000) |
| `promotion_content_type_id` requirement | V2 `submission_promotion_ready` | P | yes | none |
| PII excluded from promotion | promote-submission op | P | yes | none |
| Private moderation notes excluded from public APIs | gm-library projection (cards/detail) | P | yes | confirmed |
| `content_type` controlled vocabulary | V2 | P | yes | none |
| Tag dimension/audience/topic/region | V2 | P | yes | none |
| Safe existing-tag dimension backfill | V2 CASE + DO-raise | P | yes (pending real slugs) | see section 3 edit |
| Tag retirement behavior | V2 `is_active` + RESTRICT junctions | P | yes | none |
| `content_placement` curated-output model | V20260623150000 | A | yes | A |
| Contributor + junction | n/a | D | acceptable | D (justified) |
| File/media junction + featured image | V20260623160000 `content_item_file`, `featured_image_id` | A | yes | A |
| Related-content model or deferred | n/a | D | acceptable | D (justified) |
| Stored generated `search_tsv` | V2 | P | yes | none |
| GIN full-text index | V2 `idx_content_item_search` | P | yes | none |
| Public feed + typed-feed indexes | V20260623150000 (keyset `id` tiebreak) | F | yes | F |
| Public slug uniqueness + normalization | V2 `slug UNIQUE` + lower checks | P | yes | none |
| Privacy-review fields + publish gate | V20260623160000 | A | yes | A |
| Audit-event model + immutability decision | V20260623160000 + V20260623161000 (trigger) | A | yes | A |
| Public submission endpoint | gm-intake | A | yes | A |
| Promotion operation | promote-submission | P/F | yes | F (audit write) |
| Public search endpoint | gm-library `/search` | F | yes | F (keyset) |
| Public detail endpoint | gm-library `/items/:slug` | A | yes | A |
| Directus bootstrap-dependent FKs | V20260623160000 | A | yes | A |
| Correct Flyway/Directus ordering | runbook section 5 | A | yes | A |
| Directus public-role restrictions | section 6 | A | yes (config) | A |
| Flow accountability `$trigger` | section 6 | A | yes (config) | A |
| Test + EXPLAIN scripts | test/ | A | yes | A |

Two V2 edits still required before production, IF V2 is confirmed never-applied outside local (otherwise they are already handled forward by V20260623150000 / are data tasks):

1. Replace the example tag `CASE` mapping (`young-adult`, `all-ages`, `california`, `bay-area`) with the real tag slugs in the GM database. The `DO` block then fails loudly on any unmapped slug. This is a data-dependent task only Aaron/Pierce can complete.
2. The feed-index `id` tie-breaker: handled forward by V20260623150000 regardless, so no V2 edit is strictly required.

---

## 4. File-by-file change log

- **V20260623150000 (new, pre-bootstrap):** keyset-ready feed indexes; `content_placement` (the curated-output decision); `risk_event` (intake abuse telemetry, hashed IP only).
- **V20260623160000 (new, post-bootstrap):** `content_item` privacy-review pair + publish gate + `editorial_notes` + `featured_image_id`; `submission` `promoted_at`/`promoted_by` + review-pair check + non-pending-requires-review + promotion-audit checks; `content_item_file`; `audit_event`; all `directus_users`/`directus_files` FKs with the RESTRICT/SET NULL split.
- **V20260623161000 (new, post-bootstrap):** append-only trigger on `audit_event`.
- **promote-submission/api.js (final):** explicit `accountability.user` requirement; Directus `ForbiddenError`/structured 422; DB-default UUID for the junction; copies `source`; writes `audit_event('submission_promoted')` inside the transaction.
- **gm-library/index.js (rewrite):** offset replaced with signed keyset cursor (HMAC, `as_of`, `filters_hash`, version + sort + signature validation, `400 invalid_cursor`); `numnode()` empty-query probe; relevance-fallback normalization; strict filter/limit caps; `EXISTS` tag filters; added `/items/:slug` detail route with fixed public projection.
- **gm-intake/index.js (new):** public intake; server-owned `status=pending` and consent record (reconciled to V2 columns `consent`/`consent_at`/`consent_notice_version`); honeypot, hashed-IP rate limit, fingerprint dedupe (report's `digest()`-vs-HMAC mismatch fixed by querying `risk_event` fingerprints).

---

## 5. Deployment runbook (corrected ordering)

Use Neon DIRECT connection for Flyway/psql/backup; POOLED for the Directus runtime. Neon documents pooled for app traffic, direct for migrations and session-sensitive tooling.

```bash
# 0. Connection strings
export DATABASE_URL_DIRECT='postgresql://USER:PW@ep-xxxx.REGION.aws.neon.tech/DB?sslmode=require'
export DATABASE_URL_POOLED='postgresql://USER:PW@ep-xxxx-pooler.REGION.aws.neon.tech/DB?sslmode=require'

# 1. Preflight: confirm PG18 + uuidv7 (Neon PG18 is GA; verify on YOUR project, see note below)
psql "$DATABASE_URL_DIRECT" -c "SELECT version();"
psql "$DATABASE_URL_DIRECT" -c "SELECT uuid_extract_version(uuidv7()) AS uuid_version;"  -- expect 7

# 2. Apply schema THROUGH the last pre-bootstrap migration ONLY, via -target.
#    A bare `flyway migrate` here would attempt the post-bootstrap migrations before
#    directus_users/directus_files exist and fail. Use the real last pre-bootstrap version.
flyway -url="$DATABASE_URL_DIRECT" -locations="filesystem:./gm-backend/sql" \
       -target="20260623150000" migrate

# 3. Bootstrap Directus ONCE so directus_users / directus_files are created
#    (start the Directus service against DATABASE_URL_POOLED; command depends on deploy target)

# 4. Verify system tables, then apply the post-bootstrap migrations (no -target = run the rest)
psql "$DATABASE_URL_DIRECT" -c "SELECT to_regclass('public.directus_users'), to_regclass('public.directus_files');"
flyway -url="$DATABASE_URL_DIRECT" -locations="filesystem:./gm-backend/sql" migrate

# 5. Deploy extensions, restart Directus
#    extensions/operations/promote-submission, extensions/endpoints/gm-library, extensions/endpoints/gm-intake

# 6. Configure Directus (section 6): roles, fields, relations, manual Promote Flow, CORS, rate limits

# 7. Staging validation
psql "$DATABASE_URL_DIRECT" -f ./gm-backend/test/seed_10k.sql
psql "$DATABASE_URL_DIRECT" -f ./gm-backend/test/explain_checks.sql
psql "$DATABASE_URL_DIRECT" -f ./gm-backend/test/verification.sql   # every count must be 0
HOST="https://STAGING_DIRECTUS_HOST" ./gm-backend/test/http_tests.sh
```

Rollback stance: Flyway Community has no auto-undo, so fix-forward. A failed migration before commit rolls back via transactional DDL; a bad tag backfill fails at `SET NOT NULL` before any data is mislabeled; extension faults roll back by redeploying the prior bundle; data corruption from manual edits restores from a Neon branch, not ad hoc SQL.

Required environment variables:

```bash
GM_PROMOTION_ROLE_IDS="<moderator-role-uuid>,<admin-role-uuid>"   # promotion authorization allowlist
GM_SEARCH_CURSOR_SECRET="<random 32+ byte secret>"               # signs keyset cursors
GM_RISK_HASH_SECRET="<random 32+ byte secret>"                   # HMAC for IP hashing + fingerprints
GM_SUBMISSION_CONSENT_VERSION="2026-06-v1"                       # stamped into submission.consent_notice_version
GM_CONTACT_CONSENT_VERSION="2026-06-contact-v1"                  # stamped into submission.contact_consent_notice_version (defaults to review version if unset)
CORS_ENABLED="true"
CORS_ORIGIN="https://www.gatheringmatters.org,https://<your>.framer.website,http://localhost:3000"
RATE_LIMITER_ENABLED="true"
RATE_LIMITER_POINTS="20"
RATE_LIMITER_DURATION="1"
```

---

## 6. Directus configuration plan for Team

Flyway owns the schema; Directus owns collection metadata, interfaces, permissions, relations, and the Flow. The SQL alone is not the finished CMS.

Collections to expose: `content_item` (main editorial), `content_type` (lookup), `tag` (vocabulary), `submission` (private moderation), `content_placement` (curated placements). Hide as junctions managed relationally: `content_item_tag`, `submission_tag`, `content_item_file`. Read-only, admin/moderator only: `audit_event`, `risk_event`.

Field interfaces and visibility (highlights):
- `tag.dimension`: required dropdown of `audience`/`topic`/`region`. No default. `tag.is_active`: toggle.
- `content_item.content_type_id`: required M2O. `status`: dropdown draft/published/archived. `slug`: input, not required until publish, must save NULL when cleared (not ''). `search_tsv`: hidden, read-only. `editorial_notes`: hidden from non-editorial roles. `privacy_reviewed_at`/`by`: read-only except editors/admins. `featured_image_id`: image relation. `tags`, `files`: relational fields through the junctions. `content_placement`: relational, dropdown seeded with `idea_generator` and `home_featured`.
- `submission.status`, `promotion_content_type_id`: moderator/admin only. `content_item_id`, `promoted_*`, `reviewed_*`: read-only. `submitter_*`, `consent*`, `moderation_notes`: hidden from roles that do not need PII.

Roles and permissions:
- **Public:** NO collection read on `submission`; NO collection create on `submission`; NO read on `audit_event`/`risk_event`. Public web traffic uses only the custom endpoints `/gm-library/search`, `/gm-library/items/:slug`, `POST /gm-intake/submissions`. If you also want Directus-native detail reads on `content_item`, gate them with a filter rule `{"_and":[{"status":{"_eq":"published"}},{"published_at":{"_lte":"$NOW"}}]}` and restrict fields, but the custom detail endpoint already covers this.
- **Moderator:** read/update `submission`, manage `submission_tag`, set `status` and `promotion_content_type_id`, read `audit_event`, execute the Promote Flow.
- **Editor:** create/update `content_item`, manage content tags/files/placements, set privacy-review fields, publish.
- **Admin:** full.

Manual Promote Flow: Trigger Manual; Collection `submission`; Location Item Page Only; Require Confirmation on; Asynchronous off; **Accountability `$trigger`**; single operation `promote-submission` with `submission_id = {{$trigger.body.keys[0]}}`.

Files/object storage: configure a storage adapter (S3-compatible or local) so `directus_files` and `/assets/:id` work; `content_item_file` and `featured_image_id` depend on it. Framer must never embed a Directus static token client-side.

---

## 7. Test scripts and staging commands

See `gm-backend/test/`. Order: `seed_10k.sql` (Neon branch only), then `explain_checks.sql` (confirm intended indexes used at volume), then `verification.sql` (all counts 0; UUIDv7 = 7; uncomment the audit `UPDATE` to prove the immutability trigger errors), then `http_tests.sh` against staging. Promotion concurrency is verified by firing two simultaneous Promote calls at one approved submission and confirming exactly one `content_item` and one `submission_promoted` audit row result.

Engineering latency targets on seeded MVP volume: warm-cache p95 under 50 ms for the blank feed, under 100 ms for search. These are goals, not PG defaults.

---

## 8. Scaling roadmap and PostgreSQL topic matrix

Growth stages and the explicit "do not build yet" line:

- **Under 10k records:** the current model is the whole answer. Pooled Neon for app, direct for migrations, Neon branches for staging. Do NOT add partitioning, materialized views, read replicas, `pg_trgm`, external search, or vector search. None solve a demonstrated bottleneck here.
- **10k to 500k:** keep the model identical. Add CDN/edge caching for anonymous search/detail GETs; enable `pg_stat_statements` and watch `pg_stat_io`. Consider `pg_trgm` ONLY if users demonstrably need typo tolerance/substring matching. Consider a materialized view ONLY for a specific expensive facet-count or homepage aggregate that indexed queries cannot serve acceptably.
- **500k to several million:** same canonical model; stronger caching; deliberate backup/restore drills. An external search engine becomes justified only if common-term relevance p95 exceeds ~300 ms despite good indexes, fixed projections, limits, and caching. Partitioning only for a real retention/tenant/time-series problem, not a performance hunch.

Operational triggers: anonymous GET p95 > 100 ms at 100k rows -> caching + EXPLAIN review; relevance p95 > 150 ms at 100k -> query tightening, GIN/heap analysis; common-term relevance p95 > 300 ms at ~1M -> evaluate external search; pooler waiting connections -> pooling discipline/compute sizing; repeated heavy dashboard aggregates -> one targeted materialized view; typo tolerance needed -> `pg_trgm`.

PostgreSQL topic coverage (condensed from the brief, classified for GM):

| Area | Classification | GM use |
|---|---|---|
| Mental model/setup, basic querying, data types, table design/constraints, relationships/joins, indexes, modifying data, transactions/schema evolution, roles/security, backup/restore | Implement now | Core of the model, promotion transaction, Flyway, partial+GIN indexes, EXISTS filters, Neon PITR + pg_dump |
| Import/export, aggregation/reporting, useful techniques | Design now, implement later | Future content imports, editorial metrics, `generate_series` for test data |
| Subqueries/CTEs/set ops | Implement now | EXISTS filters, search-prep CTEs |
| JSON/JSONB | Implement now, narrowly | `audit_event.metadata`, `risk_event.details` only; never model primary content in JSONB |
| Date/time, string functions | Implement now | `now()`, `AT TIME ZONE`, slug/search normalization |
| Triggers | Implement now, narrowly | ONLY audit immutability; no broad business-logic triggers |
| PL/pgSQL, window functions, views, math | Future-specific | Migration helpers, analytics/dedup reports, reporting views; materialized views only on measured pain |
| PG18 features | Selective | UUIDv7 yes, generated columns yes, `pg_stat_io` yes; async I/O benefit limited on Neon today (`io_method=sync`) |
| Schema/DB administration | Operational only | Operate Neon/Postgres, not modeled in-app |

PG18/Neon: PostgreSQL 18 released upstream 2025-09-25 with UUIDv7, virtual generated columns, skip scan, and async I/O. On Neon specifically, the dated changelog entry of 2026-05-01 states that Postgres 18 is generally available, preview limitations are lifted, and it is fully supported for production workloads; the 2026-06-05 entry made it the default for new projects. (Note: Neon's static "version support policy" page lists supported majors but is not the live preview/GA status; the dated changelog is authoritative and more current. A reviewer pointing at the policy page to claim PG18 is still preview is reading a stale page.) So building on PG18 with native `uuidv7()` is a supported production choice now. Two real caveats remain: confirm the actual major version on your specific Neon project (version is chosen per project, so an older project may still be on 17, hence the preflight `uuid_extract_version(uuidv7())` check), and Neon still runs `io_method=sync`, so do not benchmark async-I/O gains yet.

---

## 9. Client/product decisions still required

These are genuine product calls, not engineering gaps:

1. **Consent and minors policy.** The schema records consent coherently (boolean + timestamp + notice version) and forces it server-side, but whether under-18 submissions need parental consent, an age gate, or additional notice text is a legal/policy decision for GM. The `consent_notice_version` lets you version that text once decided.
2. **Curated placements vocabulary.** `content_placement` ships with `idea_generator` and `home_featured`. Confirm the full launch list of curated surfaces so the Directus dropdown is seeded correctly.
3. **External-link-only published items.** The route gate allows a published item with an external URL and no internal slug. Confirm GM actually wants link-only library entries; if every published item must have its own page, tighten the gate to require `slug`.
4. **Idea Generator content source.** Confirm whether the generator draws only from `content_placement('idea_generator')` rows (curated) or from a broader tag/type query. The schema supports either; the endpoint query differs.
5. **Detail page reads.** Confirm Framer detail pages use the custom `/gm-library/items/:slug` endpoint (recommended) rather than Directus-native collection reads, so there is one enforcement boundary.

---

## What I did vs what remains unverified

Done in this pass (files written, not executed): three forward migrations, three reconciled/new extensions, four test scripts, this audit. Verified against live docs: Neon PG18 GA status.

Unverified until staging execution: whether V2 (and any migration) is already applied in a shared environment; that `uuidv7()` resolves on the specific Neon project (run the preflight); that every migration applies cleanly in order; that EXPLAIN shows the intended index usage at 10k+ rows; that the keyset cursor, promotion concurrency, intake abuse handling, and public-visibility exclusions behave as specified under the HTTP/SQL test matrices. I did not run any of these; they require the real repo, the Neon branch, and a booted Directus instance.

---

## 10. Round-2 corrections applied (post-review)

Each item below was a real blocker or correctness gap from the second review, now fixed in the delivered files.

1. **Flyway versions.** Letter-suffixed versions (`V202606b`, `V202607a`) are invalid for a numeric-timestamp convention. Renamed to `V20260623150000`, `V20260623160000`, `V20260623161000`. Rename only applies because these are new/unapplied; never rename an applied migration.
2. **Runbook bootstrap order.** The pre-bootstrap step now uses `-target="20260623150000"` so a bare `migrate` cannot run the post-bootstrap migrations before `directus_users`/`directus_files` exist. The post-bootstrap step runs with no target.
3. **Neon PG18.** Kept GA (it is, per the dated 2026-05-01 changelog) but now cited explicitly, flagged that the static policy page is stale, and added the per-project verify caveat plus the preflight check.
4. **Seed script.** Now seeds DRAFT rows when no privacy reviewer exists (instead of violating the publish gate with NULL reviewers), seeds tags across all three dimensions plus an inactive tag, `content_item_tag` (common + rare), `content_placement` (`idea_generator`, `home_featured`), multiple content types, archived and future-dated rows, and common/rare full-text terms. Idempotent and rerunnable on a disposable branch.
5. **HTTP tests are now assertions.** `http_tests.sh` asserts exact status codes and key JSON fields and exits non-zero on any failure. Added: strict-pagination rejections, tampered-but-parseable cursor, valid cursor continuation, duplicate intake replay, contact-consent-required, projection-exclusion check, and draft/future/archived detail exclusion.
6. **Promotion concurrency test added.** `promote_concurrency.sh` fires two parallel Promote calls and asserts exactly one linked `content_item` and one `submission_promoted` audit row, one success and one safe failure.
7. **Strict pagination.** The search endpoint rejects `12junk`, `1e3`, `0`, negatives, and over-max with `400 invalid_pagination` (no silent coercion). Added a 24h signed-cursor TTL and explicit cursor-shape checks.
8. **Intake consent + formatting.** `consent_to_contact` is now persisted (`contact_consent` / `contact_consent_at` / `contact_consent_notice_version`, all-or-nothing constraint in `V20260623150000`). Title and body use separate normalizers; body preserves paragraph breaks. The `X-Forwarded-For` trust caveat is documented in-file, and the DB rate check is labeled best-effort with the enforced limit placed at the edge.
9. **Audit immutability.** Added a statement-level `BEFORE TRUNCATE` trigger alongside the row-level UPDATE/DELETE trigger. Scope is now stated accurately: immutable against ordinary application DML, not tamper-proof against a database owner who can drop the triggers or table.
10. **Guaranteed audit events.** Documented that only `submission_promoted` is emitted by code today. The other action values are reserved, not emitted; either wire a Directus Flow/hook to emit them or rely on Directus Activity for Studio-originated changes. The doc no longer implies all workflow events are guaranteed.

Disagreement recorded: the review claimed Neon PG18 is still preview, citing the version-policy page. The dated Neon changelog (2026-05-01 GA, 2026-06-05 default) supersedes that page. I kept PG18 and corrected the citation rather than retracting an accurate statement.
