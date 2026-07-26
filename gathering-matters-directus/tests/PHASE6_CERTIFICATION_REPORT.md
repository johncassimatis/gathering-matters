# Gathering Matters — Phase 6 Promotion Certification

**Branch under test:** `pierce_dev` (Neon `br-spring-river-afpavpu8`, host `ep-purple-wind-afeh184s…`), reset from `production` before testing.
**Run id / fixture suffix:** `PHASE6_BRANCH_TEST_20260720_213224_…`
**Acting user for promotions:** Administrator `ea391a0c-df0d-4284-a265-57b6a889cf8a`
**Trigger path:** authoritative manual Flow "Promote Submission to Content" (`608faf1e-…`) via `POST /flows/trigger` with **session-cookie** auth (Bearer/static tokens are refused by the manual-flow trigger — 403). Same endpoint the Studio item-page button uses.
**Branch identity proven before any write; no production endpoint (`ep-bold-bread-afuwwq8t` / `cms.gatheringmatters.com`) present in active test config.**

| # | Test | Fixture | Role | Expected | Actual HTTP/UI | DB verification | Verdict |
|---|------|---------|------|----------|----------------|-----------------|---------|
| 1 | Approved + `promotion_content_type_id = NULL` rejected | S1 | Admin | 422 validation | HTTP **422** `PROMOTION_NOT_ALLOWED` — "promotion_content_type_id is not set" | S1 still `approved`, `content_item_id` NULL | **PASS** |
| 2 | Pending + valid content type rejected | S2 | Admin | 422 validation | HTTP **422** `PROMOTION_NOT_ALLOWED` — "submission must be 'approved', is 'pending'" | S2 still `pending`, `content_item_id` NULL | **PASS** |
| 3 | Duplicate promotion blocked, no 2nd content_item | S3 | Admin | 1st ok; 2nd fails; no new item | 1st HTTP **200**; 2nd HTTP **422** "…is 'promoted'" | `content_item` 22→23→**23**; S3 links exactly 1 item | **PASS** |
| 4 | Contributor/Editor/Publisher cannot access/trigger Flow | S6 | Contributor / Editor / Publisher (+Moderator ref) | All denied; distinguish layer; S6 never promoted | C/E/P: `GET submission` **403** + trigger **403** → **ACCESS layer**. Moderator (with empty `GM_PROMOTION_ROLE_IDS`): `GET submission` **200** but trigger **403** → **OPERATION guard** (`api.js:19-39`) | S6 `content_item_id` NULL (unpromoted) | **PASS** |
| 4b | **Allow-path:** Moderator (role in `GM_PROMOTION_ROLE_IDS`) promotes successfully | M1 | Moderator (`4eb75f60-…`) | HTTP 200; promoted as Moderator; draft; attribution = Moderator user id | HTTP **200** `{content_item_id}` | status `promoted`; `promoted_by` = Moderator uid; `content_item.status` = draft; `user_created` = Moderator uid; 1 `submission_promoted` audit; `actor_user_id` = Moderator uid | **PASS** |
| 5 | `/items/audit_event` → 403 for Moderator/Editor/Publisher/Contributor | — | Moderator/Editor/Publisher/Contributor | 403 each | **403 / 403 / 403 / 403** | Directus permission layer denies audit read | **PASS** |
| 6 | Active tag copied exactly once to `content_item_tag` | S4 | Admin | 200; tag copied once | HTTP **200** | `content_item_tag` = **1** row (`…-topic-active`, count 1) | **PASS** |
| 7 | Inactive attached tag rejected; no item/audit (source **explicitly** rejects, `api.js:77-87`) | S5 | Admin | 422; nothing created | HTTP **422** — "replace inactive tags before promotion: …-topic-inactive" | `content_item` unchanged, `audit_event` unchanged, S5 still `approved` | **PASS** |
| 8 | Promoted item `draft` / `slug` NULL / `published_at` NULL & absent publicly | S3-item, S4-item | Admin | draft, slug NULL, pub NULL, not in search, detail 404 | search 200/**0 results** (absent); detail-by-id **404** | both items `draft`, `slug` NULL, `published_at` NULL | **PASS** |
| 9 | Success attribution + exactly one audit + no risk_event | S3, S4 | Admin | promoted; ids+promoter set; user_created=actor; 1 audit; actor=actor; no risk | verified | status `promoted`; `content_item_id`/`promoted_at`/`promoted_by` set; `user_created`=acting admin; **1** `submission_promoted` audit each; `actor_user_id`=acting admin; `risk_event` = **0** | **PASS** |

**Result: 9 / 9 core tests PASS + Moderator allow-path (4b) PASS.** No stop condition encountered (connection was pierce_dev throughout; promoted items are draft/unpublished; audit attribution correct and non-null; no duplicate content_item; no unauthorized role promoted; audit immutability never touched).

## Test 4 / 4b note — the operation role gate (why the earlier Moderator request got 403)
On the branch as reset from production, `GM_PROMOTION_ROLE_IDS` is **empty** (README: *"the promotion operation safely refuses without it"*). The operation guard (`api.js:19-39`) allows `accountability.admin === true` **or** `role ∈ GM_PROMOTION_ROLE_IDS`. With the set empty, every non-admin — including Moderator — is refused with a generic `ForbiddenError` (HTTP 403), which is **correct** behavior, not a defect. C/E/P are refused *earlier*, at the Directus access layer (they cannot even read the `submission` collection). Moderator passes that access layer (submission read = 200) yet was still refused, isolating the denial to the operation guard.

**Confirmation (Test 4b):** After resetting pierce_dev again and setting `GM_PROMOTION_ROLE_IDS = <Moderator role>,<Administrator role>` (verified present inside the running container), a Moderator user promoted a valid approved submission successfully (HTTP 200), with `promoted_by`, `content_item.user_created`, and `audit_event.actor_user_id` all equal to the Moderator **user** id and the content item `status = draft`. The only variable changed between the 403 and the 200 was that env var — read solely inside the operation — which proves the earlier 403 originated in the custom operation, not the Directus access layer.

## Test 7 note (runbook expectation supported)
Source inspection of `promote-submission/src/api.js` (lines 77–87) shows the operation **explicitly** rejects inactive attached tags with a 422 `PROMOTION_NOT_ALLOWED` *before* any content_item / audit write. The runbook expectation is therefore supported, and the rejection was exercised (S5) with no content_item or audit_event created.

## Fixtures used (all `PHASE6_BRANCH_TEST_20260720_213224_`)
- S1 approved + null content type; S2 pending + valid type; S3 approved (no tags); S4 approved + 1 active tag; S5 approved + 1 inactive tag; S6 approved (role-denial target).
- 1 content_type, 1 active tag, 1 inactive tag; 4 role test users (Contributor/Editor/Publisher/Moderator).

## Cleanup
Per plan, no row-by-row cleanup. `pierce_dev` reset from production after results recorded, discarding all test rows/users. Production config restored.
