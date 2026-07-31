# Directus S3 + GuardDuty scan-gating — design

**Status:** implementation prepared on `feat/aws-s3-guardduty-storage`; no Directus,
Render, Framer, AWS, migration, or production changes are authorized by this task. The
AWS infrastructure is prepared in `infra/aws/` but remains undeployed.

This document specifies how the application should behave once files live in the
scanned S3 bucket, and — importantly — flags a foundational behavior that must be
**verified on the live Paid-plan account before any gating code is written**, because it
can change the whole architecture.

---

## 1. Current repository architecture (inspected)

**Storage.** All Directus files (whatever their origin) are stored in the single
configured storage backend, which will become the S3 media bucket. There is no
per-file storage routing.

**Upload paths:**
- **Submission attachments** — `gm-intake` endpoint (`POST /gm-intake/submissions`)
  writes files via Directus `FilesService.uploadOne` into `directus_files`, linked by
  `submission_file` (migration V007). **Submissions are private / staff-only**; these
  files are never exposed on a public endpoint.
- **Content item files** — created by staff via the Directus app / official plugin into
  `directus_files`, linked by `content_item_file` (V004), plus `content_item.featured_image_id`.

**Public download surface (the part that matters):**
`gm-library` `GET /gm-library/items/:slug` returns, for a published item, only clean,
downloadable public-submission links when scan gating is enabled. The browser follows
`/gm-library/downloads/{fileId}`, a custom request-time route that re-checks publication,
association, origin, scan state, and (for S3) the recorded object version/ETag before
streaming. Anonymous Directus `/assets/{id}` access is removed by the deployment-time
permission revocation step; the public API does not rely on a raw asset URL.

**Original bucket-policy assumption (revised by Option A):** the S3 bucket
policy denies `s3:GetObject`/`GetObjectVersion` for any object not tagged
`GuardDutyMalwareScanStatus=NO_THREATS_FOUND` (except the GuardDuty role). So a
not-yet-clean file is genuinely unreadable through `/assets` — Directus's own read is
denied — **independent of any application code**. Application gating is defense-in-depth
and UX, not the primary control. The Directus application identity is exempted from
that deny because Directus reads the object during upload; public safety is therefore
enforced by the custom request-time route and current database state. A stale or missing
database value fails closed.

**Test conventions:** `gathering-matters-directus/tests/` — vitest + supertest against a
live Directus, a `pg` client for seed/cleanup (`run-tests.js`, `cleanup.js`,
`fixtures.js`), marker-based teardown, `GM_TEST_MODE` scaffolding. Mocked-unit style is
not yet used here; new mocked tests would be additive.

---

## 2. CONFIRMED FROM SOURCE — Directus reads the object during upload

Verified against the exact deployed version, **Directus 12.0.2** (`FROM
directus/directus:12.0.2` in `gathering-matters-directus/Dockerfile`, the only pin;
local and Render both build from it):

- `FilesService.uploadOne()` (`api/src/services/files.ts`) after writing the stream calls,
  **unconditionally for every file**:
  `const { size } = await storage.location(payload.storage).stat(payload.filename_disk);`
  then `extractMetadata(payload.storage, ...)`.
- `extractMetadata()` (`api/src/services/files/lib/extract-metadata.ts`) for supported
  image types does:
  `const stream = await storage.location(storageLocation).read(data.filename_disk);` and
  pipes it into `getMetadata()`.
- S3 driver (`packages/storage-driver-s3/src/index.ts`): `read()` sends
  `GetObjectCommand`; `stat()` sends `HeadObjectCommand`.

**Conclusion (conclusive, source-based):** Directus performs a storage read of the just
uploaded object **synchronously inside `uploadOne`, before GuardDuty can scan and tag it**
(GuardDuty scanning is asynchronous and starts only after the PUT). Specifically:

- **Images (JPEG/PNG/WebP — all in the gm-intake allowlist):** `extractMetadata` issues a
  **`GetObject`**. The bucket policy's `NoReadUnlessClean` explicitly denies `s3:GetObject`
  for the untagged object, so **image uploads fail**. (Certain.)
- **Every file type:** the post-write `stat()` issues **`HeadObject`, which S3 authorizes
  via `s3:GetObject`** (there is no separate `s3:HeadObject` IAM action). The same deny
  therefore also blocks `stat()` on the untagged object, so **non-image uploads (PDF/DOCX)
  fail at `stat()` as well.** The absent tag makes the `StringNotEquals ... NO_THREATS_FOUND`
  condition evaluate true (fail-closed), so the deny applies.

> The earlier plan called this a risk to confirm with a live test. **It is now confirmed
> from source; a live test would only re-confirm it.** The current single-bucket
> tag-based-deny template is therefore **NOT deploy-ready** as written.

---

## 2a. Architecture decision — Option A vs Option B

Because Directus (the application identity) must read the object immediately after upload,
the bucket policy cannot deny `s3:GetObject` to the Directus identity. Two ways forward:

### Option A — Public-distribution gating (Directus may read unscanned objects)

- **Bucket policy:** exempt the Directus app identity from `NoReadUnlessClean` (add it to
  the `NotPrincipal` list beside the GuardDuty role). Directus can then `stat`/`read` any
  object (scanned or not) for metadata **and** for serving.
- **Where the clean-file guarantee lives:** since the bucket policy no longer blocks
  Directus from serving an unscanned object, **public distribution must be gated in the
  application** — `gm-library` returns only clean files (per §6), and public access to
  `/assets` must be gated so a public user cannot fetch a non-clean file id. The bucket
  policy still blocks every *non-Directus* principal (BPA + the deny), so there is no
  direct-to-S3 public path.
- **Security tradeoff (state plainly):**
  1. **Directus itself reads and parses unscanned, potentially-malicious bytes** — for
     images, sharp/libvips parses the file during `extractMetadata` before any scan. A
     malicious image exploiting a libvips vulnerability could affect the Directus process.
     This is a real but low-probability, bounded server-side risk.
  2. The "no public download until clean" guarantee now depends on **application code**,
     not the bucket policy. A gating bug could serve a not-clean file. Mitigate with
     fail-closed gating + tests.
- **IAM:** unchanged (`gm-directus-s3-app` already has `s3:GetObject/GetObjectVersion`).

### Option B — Pre-processing quarantine (Directus never reads unscanned objects)

- **Flow:** a custom intake path uploads the raw bytes **directly to a quarantine
  bucket/prefix via the AWS SDK, bypassing Directus `FilesService`** (so no `stat`/`read`
  on unscanned data). GuardDuty scans the quarantine bucket. A Lambda, on
  `NO_THREATS_FOUND`, copies the object into the Directus **serving** bucket and creates
  the `directus_files` record (or triggers a Directus import that now reads a clean
  object). Non-clean objects are quarantined/deleted, never copied.
- **Buckets/IAM:** a quarantine bucket (GuardDuty MP plan + tag-based deny target) and a
  serving bucket (holds only clean objects, so no scan-gating needed there). Intake
  identity: `PutObject` on quarantine only. Copy-Lambda role: `GetObject` +
  `GetObjectTagging` on quarantine, `PutObject` on serving, `DeleteObject` on quarantine.
  Directus serving identity: R/W on the serving bucket only.
- **Extra work:** a custom raw-upload path replacing `FilesService` for intake, the
  copy Lambda, `directus_files` record creation for copied objects, quarantine cleanup,
  and failure handling (copy failures, orphan quarantine objects, retries). Materially more.
- **Security:** strongest — Directus never touches unscanned bytes; the bucket policy stays
  the authoritative gate.

### Threat model and recommendation

GM's dominant threat is **users/staff downloading a malicious submitted attachment**
(public distribution safety). Protecting **Directus itself** from parsing a malicious
image (a libvips 0-day) is a secondary, low-probability concern.

**Recommendation: Option A**, for GM's scale and threat model — it prevents malicious
downloads (private bucket + app-layer clean-file gating) without the heavy quarantine
pipeline, accepting the bounded, low-probability server-side image-parsing risk. Choose
**Option B only if** the org's risk appetite requires the bucket policy to remain the sole
authoritative gate and requires Directus to never parse unscanned bytes; it is
significantly more infrastructure and custom code. **This is a risk-appetite decision for
the team; nothing is implemented until it is made.**

### Exact CloudFormation changes required

**For Option A** — in `MediaBucketPolicy`, statement `NoReadUnlessClean`, add the Directus
user to `NotPrincipal` (this is the deliberate, documented weakening; do not apply until A
is chosen):

```yaml
          - Sid: NoReadUnlessClean
            Effect: Deny
            NotPrincipal:
              AWS:
                - !Sub "arn:aws:sts::${AWS::AccountId}:assumed-role/${GuardDutyRoleName}/GuardDutyMalwareProtection"
                - !GetAtt GuardDutyScanRole.Arn
                - !GetAtt DirectusAppUser.Arn        # ADD: lets Directus stat/read for metadata + serving
            Action: [s3:GetObject, s3:GetObjectVersion]
            ...
```

Keep `OnlyGuardDutyCanTagScanStatus` and `DenyInsecureTransport` unchanged (Directus still
cannot set the scan tag). App-layer gating (§6) becomes **required**, not optional.

**For Option B** — a larger template change: add a second (quarantine) bucket, retarget the
`MalwareProtectionPlan` + tag-based deny to the quarantine bucket, remove the deny from the
serving bucket, add the copy-Lambda + its role and EventBridge target, and split IAM
(intake PutObject-only on quarantine; Directus R/W on serving only). Specified above; full
template to follow only if Option B is chosen.

---

## 3. How the application learns scan status

The S3 object tag is authoritative. The app needs a queryable copy. Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. EventBridge -> Lambda -> Directus webhook (recommended)** | GuardDuty scan-result event (already the SNS event source) also targets a small Lambda that calls a token-authenticated Directus endpoint to set `scan_status` on the file row | Event-driven, near real-time, no per-request S3 latency, single source of truth for status | One Lambda + one internal endpoint to build; needs the Paid plan to test end to end |
| B. Lazy tag query + cache | On access, if `scan_status` is unknown, the app calls `s3:GetObjectTagging` and caches the result | No Lambda | Adds S3 latency + `s3:GetObjectTagging` to the app IAM policy (not currently granted); still needs a cache |
| C. Poll | Scheduled job reconciles tags -> DB | Simple | Latency, wasteful |

**Recommendation: Option A.** DB `scan_status` is a **cached, event-synchronized** copy;
the **S3 tag + bucket policy remain authoritative** (a stale/missing DB value must fail
closed — treat unknown as not-clean).

---

## 4. Scan-status model and state handling

Introduce a `scan_status` on the file-link rows, default `PENDING`:

| Status | Meaning | Public download listed? | Custom download route |
|---|---|---|---|
| `PENDING` | not yet scanned / unknown | No | Denied |
| `NO_THREATS_FOUND` | clean | **Yes, only with editorial approval** | Allowed |
| `THREATS_FOUND` | malware | No (neutral "unavailable") | Denied |
| `UNSUPPORTED` | could not scan | No | Denied |
| `ACCESS_DENIED` | GuardDuty could not read | No | Denied |
| `FAILED` | scan failed | No | Denied |

Rule: **only `NO_THREATS_FOUND` is downloadable; everything else (including unknown)
fails closed.**

---

## 5. Database fields — Flyway migration (drafted, not applied)

Yes, a field is warranted for efficient public queries and admin visibility. Add
`scan_status` (+ `scan_status_updated_at`) to `content_item_file` and `submission_file`.
**The S3 tag stays authoritative; the column is a synchronized cache.**

```sql
-- V008_<ts>__file_scan_status.sql  (DRAFT — do not apply to production here)
DO $$ BEGIN
  IF to_regclass('public.content_item_file') IS NULL
     OR to_regclass('public.submission_file') IS NULL THEN
    RAISE EXCEPTION 'content_item_file / submission_file missing; apply V004 and V007 first.';
  END IF;
END $$;

CREATE TYPE file_scan_status AS ENUM
  ('PENDING','NO_THREATS_FOUND','THREATS_FOUND','UNSUPPORTED','ACCESS_DENIED','FAILED');

ALTER TABLE content_item_file
  ADD COLUMN scan_status file_scan_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN scan_status_updated_at timestamptz;
ALTER TABLE submission_file
  ADD COLUMN scan_status file_scan_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN scan_status_updated_at timestamptz;

CREATE INDEX idx_content_item_file_clean
  ON content_item_file (content_item_id) WHERE scan_status = 'NO_THREATS_FOUND';
COMMENT ON COLUMN content_item_file.scan_status IS
  'Cached copy of the S3 GuardDutyMalwareScanStatus tag. The S3 tag + bucket policy are authoritative; unknown/stale must be treated as not-clean.';
```

---

## 6. Directus extension changes (planned)

1. **`gm-library` detail endpoint** — behind the feature flag, filter `files` to
   `scan_status = 'NO_THREATS_FOUND'`, and null out `featured_image_id` unless its file
   is clean. Fail closed on any lookup error. No scan diagnostics in the public payload.
2. **New internal endpoint** `POST /gm-intake/scan-result` (or a dedicated extension) —
   receives the EventBridge/Lambda callback, authenticated by a shared secret
   (`GM_SCAN_WEBHOOK_SECRET`); maps `s3ObjectDetails.objectKey` -> `directus_files` ->
   the file-link row; sets `scan_status`. Requirements:
   - **Idempotent** (repeat events set the same value; no side effects on duplicates).
   - **Duplicate/late/out-of-order events** handled (only advance to a terminal status;
     never move `NO_THREATS_FOUND` back to `PENDING`).
   - **Missing/malformed events** -> log and 400, never crash.
   - **Logging** without secrets or file contents; never log the object bytes, IAM
     details, or the webhook secret.
3. **`gm-intake` upload path** — unchanged in logic; new rows are `PENDING` by default.

---

## 7. Frontend (Framer) contract

Only neutral states, consistent with existing design — **do not surface "malware
detected" publicly**:
- File clean -> show the download as today.
- File pending -> optional neutral "Attachment is being processed" or simply omit it.
- File blocked/failed/unsupported/denied -> omit it (or neutral "Attachment unavailable").
- No attachment -> nothing shown (current behavior).

Because the public API already omits non-clean files (§6), the frontend change is
minimal: it just renders whatever `files`/`featured_image_id` the API returns, and needs
no knowledge of scan states. This keeps enforcement server-side, not frontend hiding.

---

## 8. Feature flag

`GM_SCAN_GATING_ENABLED` (default **false**). When false, behavior is exactly as today
(no gating, no webhook effect on responses). When true, §6 gating applies. The bucket
policy is always authoritative regardless of the flag.

---

## 9. Test matrix (mocked; no live AWS)

Unit/integration tests with mocked scan states (seed `scan_status` directly; mock the
webhook payloads — no live S3/GuardDuty):
- clean file is returned/downloadable; PENDING/THREATS_FOUND/UNSUPPORTED/ACCESS_DENIED/
  FAILED/missing-tag are all withheld from the public detail response;
- webhook sets status correctly; **duplicate events are harmless**; out-of-order events
  never regress a terminal status; malformed event -> 400, no crash;
- public API never leaks a blocked file's id/label/metadata or scan diagnostics;
- flag off -> responses identical to current behavior (regression guard);
- existing non-file content behavior (search, tags, card list) unchanged;
- (documented, verified live later) Directus cannot overwrite the GuardDuty tag — this is
  enforced by the bucket policy `OnlyGuardDutyCanTagScanStatus`, tested against real S3.

---

## 10. Rollout / rollback

**Rollout order:** (1) account on Paid plan; (2) deploy `infra/aws/` stack, confirm plan
`ACTIVE` + SNS confirmed; (3) **run the §2 read-after-write test upload** and choose
single-bucket vs quarantine-bucket; (4) apply the V008 migration to a branch, then prod
via the normal Flyway-from-main flow; (5) deploy the extension changes with
`GM_SCAN_GATING_ENABLED=false`; (6) point Directus at S3 in a planned Render window;
(7) enable the flag; (8) verify.

**Rollback:** set `GM_SCAN_GATING_ENABLED=false` (instant, reverts to current behavior);
Render storage can revert to the prior backend in the same window; the migration is
additive (columns can remain unused). The bucket policy stays as the safety net.

---

## 11. Admin remediation workflow

Admins (Directus app) see `scan_status` + `scan_status_updated_at` on file rows. For a
`THREATS_FOUND`/`FAILED`/`UNSUPPORTED` file: it is already unreadable; delete the object
(and versions) via an authorized admin, and remove/replace the `content_item_file` /
`submission_file` link. Never edit the GuardDuty tag. SNS emails alert on these statuses.

---

## 12. Known limitations

- DB `scan_status` is eventually consistent with the S3 tag; unknown/stale is treated as
  not-clean (fail closed).
- A clean file remains briefly unavailable between upload and scan completion.
- `UNSUPPORTED` (e.g., password-protected) files are permanently withheld by design.
- Standalone Malware Protection for S3 does not store scan history beyond tags + events.

---

## 13. Manual production verification checklist (once Paid plan is live)

- [ ] Stack deployed; MP plan `ACTIVE`; SNS email confirmed.
- [ ] **Read-after-write test:** upload one benign file through Directus; confirm the
      upload succeeds and whether Directus reads it before it is tagged (decides
      single-bucket vs quarantine-bucket).
- [ ] Clean file: tag becomes `NO_THREATS_FOUND`; `/assets` serves it; public detail lists it.
- [ ] Pre-clean/blocked file: `/assets` denied; public detail omits it.
- [ ] Directus app identity cannot overwrite `GuardDutyMalwareScanStatus` (403).
- [ ] Webhook sets `scan_status`; duplicate events harmless.
- [ ] Flag off = current behavior; flag on = gating active.

---

## 14. Optional future CI

Record `cfn-guard` as a **future CI enhancement** for the CloudFormation template
(security/compliance policy-as-code), alongside the existing `cfn-lint`. Not installed now.

---

# Implementation status, testing, operations, and deploy gates (Increments 1-7)

Branch `feat/aws-s3-guardduty-storage`. **Nothing is deployed by this corrective task**;
  the historical permission layer was applied to production with explicit owner authorization
(prod is licensed and holds no real/confidential data). All feature code is behind
flags that default OFF.

## What each increment delivered
1. **`V009`** migration: `submission_file` + `file_scan` (one current scan record per
   file; PENDING fail-closed default). Not applied to production.
2. **Directus permission layer** (`tools/provision-scan-file-permissions.mjs`): folder-
  based authenticated `directus_files` read gating (Pending / Clean Staff Review /
  Public Downloads), field-restricted (no `filename_disk`/`storage`). Anonymous raw
  `/assets` access is not provisioned; `--revoke-public-assets` removes the earlier exact
  managed anonymous policy during deployment. Idempotent, `--dry-run`, `--rollback`.
3. **`gm-intake` document intake** (flag `GM_PUBLIC_FILE_UPLOADS_ENABLED`, off): PDF/DOCX/
   PPTX/XLSX/TXT only; bounded PDF-signature + OOXML central-directory validation; stores
   to Pending folder; records `file_scan` PENDING; exposes no file id/key.
4. **Scan consumer + Option A CFN** (flag `GM_SCAN_CONSUMER_ENABLED`, off): EventBridge to
   SQS(+DLQ) to a scheduled consumer; atomic `file_scan` + folder move; a clean result
   releases only Pending to Clean Staff Review. Bucket policy exempts the Directus identity
   from the read deny (`ArnNotEquals aws:PrincipalArn`).
5. **Editorial + gm-library gating** (flag `GM_SCAN_GATING_ENABLED`, off): a file is public
   only when clean + published + is_download + active; revocation is immediate. Public
   documents use `/gm-library/downloads/:fileId`; trusted staff media uses
   `/gm-library/media/:fileId`.
6. **Framer prep**: allowlist/validation in `gmFormValidation.ts` + `framer/ATTACHMENT_HANDOFF.md`.

## What was tested, and how
- **Historical authorized production check:** the pre-correction Directus permission layer -
  27/27 role-by-role `/assets` + `/files` assertions (Public/Contributor/Moderator/Editor/
  Publisher), idempotent re-provision (0 duplicates), field restriction. This does not
  validate the corrected custom route or the new public-policy revocation step.
- **Disposable Postgres:** `V009` applies; PENDING default, one-per-file UNIQUE, status CHECK.
- **Mocked unit tests (no live AWS/Directus):** document validator 11/11; scan-event logic
  9/9 (all statuses, dup/stale/wrong-account/region/bucket/malformed/fail-closed); editorial
  gate 4/4 (exhaustive truth table incl. the two proofs below).
- **cfn-lint:** rerun on the corrected Option A template before deployment.

## The two proofs (Increment 5)
Exhaustive truth-table tests prove: (a) **editorial approval cannot override a non-clean
scan** (any non-`NO_THREATS_FOUND` status resolves to Pending, never public), and (b) **a
clean scan alone cannot create public access** (must also be published + is_download +
active). The consumer additionally can only move a clean file Pending to Clean Staff Review,
never to Public Downloads.

## Environment-specific restricted-resource finding (narrow, verified)
- The **stock disposable Directus 12.0.2** used in testing **rejected filtered permission
  creation** with `custom_permission_rules_enabled is a restricted resource` (403).
- The **licensed Gathering Matters production instance accepted** the filtered permission rules.
- Production was therefore used for the authorized permission tests.
- This is a narrow, observed finding for these two environments; it is not a general claim
  that custom permission rules are universally a licensed feature.

The stock disposable Directus 12.0.2 environment used during testing rejected filtered
permission creation with `custom_permission_rules_enabled is a restricted resource`,
while the licensed Gathering Matters production instance accepted the filtered rules.

## Administrator-level residual risk (accepted)
A full Directus **administrator bypasses all role permissions** and can manually move a file
into the Public Downloads folder, bypassing the scan + editorial workflow. This is an accepted
admin-level residual risk. Production currently has **2 users with Admin Access**; **keep Admin
Access limited to those two intended trusted users** and audit before activation.

## Other residual risks / limitations
- The Directus application identity retains technical S3 read permission (Option A) - a
  compromised Directus process could read pending objects. Accepted.
- Bounded validation reads a small amount of untrusted input pre-scan (PDF header; OOXML
  central directory only - never inflated). Accepted.
- **`NO_THREATS_FOUND` reduces but does not guarantee a file is harmless** - allowed documents
  may still contain malicious links, social-engineering content, external references, parser
  exploits, or spreadsheet-formula attacks that malware scanning does not catch.
- CSV is **excluded** (formula-injection is outside malware-scan guarantees). Images are
  **excluded from public uploads** (Directus parses images on upload, pre-scan); trusted staff
  image management is unchanged. OpenDocument excluded (no current requirement).
- Scan state is eventually consistent with the S3 tag; unknown/stale is treated as not-clean.

## Malware-clean vs editorial publication
Separate gates. A clean scan only moves a file into Clean Staff Review. Public availability
additionally requires published content + explicit `is_download` + the Public Downloads state.
Clean status never publishes a file.

## Admin remediation / rejection / resubmission
- `THREATS_FOUND`/`FAILED`/`UNSUPPORTED`/`ACCESS_DENIED` files stay in Pending (inaccessible);
  the SNS alert fires. An authorized admin deletes the object (and versions) and removes the
  association; do not edit the GuardDuty tag. For `UNSUPPORTED` (e.g. password-protected), ask
  the submitter for an unprotected replacement.
- Threat-positive files are NOT auto-deleted initially - kept inaccessible, alert engineering,
  delete via a controlled procedure.

## Event delivery, retries, DLQ
EventBridge to SQS (all scan results) to a scheduled consumer (`*/1` default). At-least-once +
idempotent; visibility timeout 90s; `maxReceiveCount` 5 then dead-letter; a CloudWatch alarm on
DLQ depth publishes to the SNS topic. Only the EventBridge rule may send to the queue.

## Deployment order (all gated on the AWS Paid-plan upgrade)
1. Upgrade the AWS account to the Paid plan (GuardDuty). 2. Deploy `infra/aws/storage-security.yaml`
(change-set review then execute); confirm the MalwareProtectionPlan is ACTIVE and confirm the SNS
email subscription. 3. Apply `V009` on a branch, then production via the normal Flyway-from-main
flow. 4. Set the Directus env: `STORAGE_*` (S3), the three folder IDs (from the provisioning
output), `GM_GUARDDUTY_SCAN_QUEUE_URL` (stack output), `GM_SCAN_EXPECTED_ACCOUNT`, in a planned
Render window. 5. Deploy the rebuilt extensions with all flags OFF. 6. Do the **read-after-write
confirmation** (upload one benign doc; confirm it succeeds). 7. Flip flags on:
`GM_SCAN_CONSUMER_ENABLED`, `GM_SCAN_GATING_ENABLED`, then `GM_PUBLIC_FILE_UPLOADS_ENABLED`.
8. Before upload activation or any Framer publication, run the mandatory public-asset
revocation gate: (a) run `node tools/provision-scan-file-permissions.mjs --dry-run
--revoke-public-assets`; (b) review the exact legacy-policy removal; (c) rerun without
`--dry-run` to apply the managed revocation; (d) verify anonymous
`/assets/<known-test-uuid>` is denied; and (e) verify the custom
`/gm-library/downloads/:fileId` route still succeeds only for a published, active,
downloadable, clean file with a current object identity. Any revocation failure is a
hard no-go. Only after those checks may uploads be enabled and Framer be published.
9. Wire + publish the Framer form (ATTACHMENT_HANDOFF.md).

## Remaining deploy gates (still required)
AWS Paid-plan upgrade; live GuardDuty scan test (clean + EICAR only with explicit approval); the
production role-by-role smoke test (admins bypass, so ordinary-role tokens); confirm Admin Access
is limited to the 2 trusted users; SNS email confirmation.

## Rollback
Flags OFF instantly revert behaviour. `node tools/provision-scan-file-permissions.mjs --rollback`
removes the managed permissions/policies/access (folders left, may hold files). Stack teardown =
delete the CFN stack (bucket is `RetainExceptOnCreate`). `V009` is additive (tables/columns can
remain unused). Render storage can revert in the same window.

## Conditions that would require Option B (quarantine bucket)
No application process may read file contents before scanning; a compliance/legal/insurance/grant
mandate for true quarantine; anonymous image uploads required; archives/executables/macro-enabled/
high-risk formats required; high-volume or actively hostile uploads; any component renders/converts/
previews/thumbnails allowed public documents before scan; `/assets` cannot reliably deny pending
files for all ordinary roles; scan state cannot be protected from ordinary staff; the event
workflow cannot fail closed; Admin Access cannot be limited; raw S3/presigned access must be
exposed pre-scan.

## Maintenance responsibilities after handoff
Keep the AWS billing account current; rotate the Directus S3 key if exposed; watch the DLQ alarm +
SNS malware alerts and run the remediation procedure; keep Admin Access to the 2 trusted users;
monitor storage growth (optional orphan sweep is a future job).

## Corrective verification record

Repository-side verification completed without deploying the feature:

- 34 Node-based extension tests pass, including document validation, public-download revocation,
  transaction-bound publish failure, GuardDuty event validation, retry-before-row, duplicate and
  stale delivery, version/ETag mismatch, and threat-positive retention.
- All five built extensions bundle successfully from tracked lockfiles. `cfn-lint` reports no
  findings and AWS `cloudformation validate-template` succeeds with `CAPABILITY_NAMED_IAM`.
- The authorized production inspection was read-only and sanitized: three managed root folders
  exist, the file count is zero, the temporary marker-user queries returned zero, two users match
  the Administrator role, and five managed file-read policies/access links are present.
- Production also still contains one legacy managed anonymous Public policy and one access link.
  This is an explicit deployment blocker; the corrective task did not revoke it. Run
  `node tools/provision-scan-file-permissions.mjs --revoke-public-assets` only in the controlled
  deployment window after the custom download route is live.
- The stock disposable Directus 12.0.2 environment used during testing rejected filtered
  permission creation with `custom_permission_rules_enabled is a restricted resource`, while
  the licensed Gathering Matters production instance accepted the filtered rules.

No production file, user, permission, record, migration, AWS resource, Render variable, or Framer
publication was changed by this corrective task. Live Directus startup, disposable Postgres,
Docker-image startup, GuardDuty scan, and role-by-role post-deployment smoke tests remain live
deployment gates.
