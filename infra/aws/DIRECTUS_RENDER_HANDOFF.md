# Directus / Render handoff — S3 media storage

Prepared during the AWS build. **Do not change production Render variables yet** — apply
these only in a separate, planned deployment window with a rollback plan. This task does
NOT migrate existing Directus files.

## Render environment variables (Directus S3 storage)

Set these as Render **secret** environment variables. The key and secret come from the
one-time access key created for `gm-directus-s3-app` after the stack is deployed and
verified (delivered via a local file path, never in this doc, chat, or Git).

```env
STORAGE_LOCATIONS=s3
STORAGE_S3_DRIVER=s3
STORAGE_S3_KEY=<AWS_ACCESS_KEY_ID>
STORAGE_S3_SECRET=<AWS_SECRET_ACCESS_KEY>
STORAGE_S3_BUCKET=<CREATED_BUCKET_NAME>
STORAGE_S3_REGION=us-west-2
STORAGE_S3_SERVER_SIDE_ENCRYPTION=AES256
```

- `<CREATED_BUCKET_NAME>` = `gathering-matters-directus-media-025452941754-us-west-2` (confirm from the stack output `BucketName`).

## Scanning model — what to expect operationally

- **Uploads are scanned asynchronously.** After Directus uploads an object, GuardDuty
  Malware Protection for S3 scans it and tags it with `GuardDutyMalwareScanStatus`. Until
  the tag is `NO_THREATS_FOUND`, the bucket policy **denies reads** of that object (to
  everyone except the GuardDuty and Directus application identities). Public delivery
  is still blocked by the custom route until the database scan state is clean and the
  content is editorially published. A freshly uploaded file may be briefly unavailable
  (typically seconds to a couple of minutes) until the scan completes.
- Public document attachments are served by `GET /gm-library/downloads/:fileId`, not by
  anonymous Directus `/assets/:id`. The route rechecks current clean scan state,
  publication, association, and S3 version/ETag. The deployment operator must run
  `--revoke-public-assets` to remove the legacy managed anonymous asset policy.
- Trusted staff-managed featured media is served separately by `/gm-library/media/:fileId`.
- Reviewers use the authenticated `gm-review` endpoint; it returns neutral `PENDING` /
  `UNAVAILABLE` states and never exposes S3 keys or GuardDuty diagnostics.

### Scan-status values (`GuardDutyMalwareScanStatus`)

| Value | Meaning | Readable via bucket policy? |
|---|---|---|
| `NO_THREATS_FOUND` | Clean | Yes |
| `THREATS_FOUND` | Malware detected | No |
| `UNSUPPORTED` | Could not be scanned (e.g. password-protected) | No |
| `ACCESS_DENIED` | GuardDuty could not access the object | No |
| `FAILED` | Scan failed | No |
| (no tag yet) | Awaiting scan | No |

Inspect a specific object's status:

```powershell
aws s3api get-object-tagging --bucket <bucket> --key <object-key> --region us-west-2
```

## Alerts

- An SNS topic (`gathering-matters-s3-malware-alerts`) emails on any scan result needing
  attention (`THREATS_FOUND`/`UNSUPPORTED`/`ACCESS_DENIED`/`FAILED`), not on clean results.
- **The SNS email subscription must be confirmed** from the recipient inbox after deploy.
  The previous confirmation email (from the rolled-back attempt) is dead — its topic was
  deleted; ignore that link. A new confirmation email is sent on the successful deploy.

## Reviewing and removing a malicious object safely

1. When alerted, do not download/open the object. Identify it from the alert (bucket, key).
2. It is already unreadable by the application (bucket policy). To remove it, an authorized
   admin deletes the object (and its versions): `aws s3api delete-object --bucket <bucket> --key <key> [--version-id <id>]`.
3. Do not modify the `GuardDutyMalwareScanStatus` tag; only GuardDuty may set it.

## Rotating / disabling the Directus access key

- **Rotate:** create a second access key for `gm-directus-s3-app`, update the Render env
  vars, verify uploads work, then deactivate and delete the old key.
- **Disable a compromised key immediately:**
  `aws iam update-access-key --user-name gm-directus-s3-app --access-key-id <id> --status Inactive`,
  then delete it. Existing stored files are unaffected.

## Not done by this task

- No changes to the running Directus or Render deployment.
- No migration of existing Directus files into the new bucket.
- Production Render variables should change only in a planned window with a rollback plan.


## Scan-gating env vars (Increments 3-7; all default OFF)

Set these only when activating the feature, in a planned Render window (see the full
deployment order in `gathering-matters-db/docs/s3-scan-gating-design.md`):

```env
GM_PUBLIC_FILE_UPLOADS_ENABLED=false   # public document intake (PDF/DOCX/PPTX/XLSX/TXT)
GM_SCAN_CONSUMER_ENABLED=false         # SQS scan-result consumer (Pending -> Clean Staff Review)
GM_SCAN_GATING_ENABLED=false           # gm-library + editorial folder gating
GM_PUBLIC_DOWNLOAD_REQUIRE_VERSION=true # require the recorded current S3 version
GM_PUBLIC_DOWNLOAD_REQUIRE_ETAG=true    # require the recorded current S3 ETag
GM_PENDING_FOLDER_ID=<uuid>            # from provision-scan-file-permissions.mjs output
GM_CLEAN_REVIEW_FOLDER_ID=<uuid>
GM_PUBLIC_DOWNLOADS_FOLDER_ID=<uuid>
GM_GUARDDUTY_SCAN_QUEUE_URL=<stack output ScanResultQueueUrl>
GM_SCAN_EXPECTED_ACCOUNT=025452941754
```

Flip them on in the order: consumer, gating, then uploads. `false` on any of them
instantly reverts to current behaviour. The Directus permission layer is applied via
`tools/provision-scan-file-permissions.mjs`. Run `--revoke-public-assets` explicitly during
that deployment window; it has not been run by this task.

## Authenticated staff-managed scan upload (controlled clean-file test)

`POST /gm-intake/staff-files` is the supported way to put ONE benign document
through the real scan workflow without enabling the public intake form. It creates
the S3 object (Pending folder) AND the matching `file_scan(PENDING, origin=STAFF_MANAGED)`
in one flow, so the consumer can correlate GuardDuty's event by the exact S3 object key.

```env
GM_STAFF_FILE_UPLOADS_ENABLED=false   # keep OFF except during a controlled test
GM_STAFF_FILE_UPLOAD_ROLE_IDS=        # extra role UUIDs allowed (admins always allowed)
```

- **Auth:** administrator (Directus accountability) or a role in
  `GM_STAFF_FILE_UPLOAD_ROLE_IDS`. Anonymous/unlisted callers get `403`; while the
  flag is off the route returns `404` (fail-closed). `GM_PENDING_FOLDER_ID` is required.
- **Request:** `multipart/form-data`, one file under field `attachments` (PDF/DOCX/
  PPTX/XLSX/TXT only; images/CSV/executables/mismatches/empty/oversize/multiple are
  rejected). Optional `submission_id` (a canonical UUIDv7 of an existing submission)
  creates a `submission_file` association; omit it for a standalone file.
- **Response:** `{ data: { file_id, scan_state:"PENDING", status:"pending_scan",
  association_id? } }` — no object key/etag/version/`filename_disk`/signed URL.

### Run one controlled clean-file test, then disable
1. Confirm the consumer is enabled and the queues are empty.
2. Temporarily set `GM_STAFF_FILE_UPLOADS_ENABLED=true` (and, if using a non-admin
   operator, add their role to `GM_STAFF_FILE_UPLOAD_ROLE_IDS`); redeploy.
3. As an admin/allowlisted staff user, POST one benign `.txt` to `/gm-intake/staff-files`.
4. Verify: one `directus_files` row in Pending; one `file_scan` PENDING/STAFF_MANAGED
   with `object_key` == the S3 key; GuardDuty tags it `NO_THREATS_FOUND`; the event
   reaches the main queue; the consumer moves it to Clean Staff Review and drains the
   queue; anonymous `/assets/<id>` is denied; nothing is published or public.
5. Set `GM_STAFF_FILE_UPLOADS_ENABLED=false` again (and remove any temporary role id).

**Why not just upload through `/files`?** A plain Directus `/files` upload creates the
S3 object but **no `file_scan` row**, so GuardDuty's event is unmatched by the consumer,
retried, and eventually dead-lettered. **Why not raw SQL?** Hand-inserting a `file_scan`
row is unsupported, easy to get wrong (object key/version/etag), and bypasses validation
and the read-after-write identity capture; this route reuses the proven intake logic.

## Scan gating enabled (production milestone)

- **Enabled:** 2026-08-04 — `GM_SCAN_GATING_ENABLED=false -> true` (only that variable changed).
- **Render deploy:** `dep-d9p5bgr7uimc73ak1vk0`, live commit `d237c0f`, trigger `api`.
- **Final flags:** `GM_PUBLIC_FILE_UPLOADS_ENABLED=false`, `GM_SCAN_CONSUMER_ENABLED=true`,
  `GM_SCAN_GATING_ENABLED=true`, `GM_TEST_MODE=false`, `GM_STAFF_FILE_UPLOADS_ENABLED=false`;
  `GM_STAFF_FILE_UPLOAD_ROLE_IDS` remains absent.
- **Retained clean artifact:** file `464be434...`, scan `019fcc43...`, `NO_THREATS_FOUND`,
  `Clean Staff Review`, unpublished, no submission association.
- **Production clean-path result:** clean artifact remains reviewable by authenticated staff,
  did NOT auto-publish (Public Downloads=0), anonymous `/assets` denied (403), public
  `/gm-library/downloads` denied (404). Six extensions load; 0 permission/gate errors; queues 0/0/0.
- **Disposable unsafe-status matrix:** see the dedicated "Disposable scan-gating
  certification" section below (real Directus 12.0.2 + PG18 stack, actual HTTP routes).
- **Still disabled:** public uploads and staff uploads remain OFF.
- **Launch gate:** the production threat-positive (`THREATS_FOUND`) GuardDuty test remains
  PENDING approval of the exact harmless test artifact/procedure; public launch stays blocked
  until it is completed. This account runs Malware Protection for S3 as an independent feature
  (no detector), so a threat produces the EventBridge scan-result event + object tag + SNS alert,
  but no GuardDuty finding.

## Disposable scan-gating certification (2026-08-04)

Certified against a real disposable stack, not mocks: `postgres:18-alpine` +
`directus/directus:12.0.2` built from this repo (all six extensions loaded),
full Flyway migrations `V001-V009` applied as `gm_migrator`, provisioning grant
scripts `01-07` applied (tables owned by `gm_migrator`, runtime grants to
`gm_directus`), the three managed folders created, and `GM_SCAN_GATING_ENABLED=true`
with prod-matching flags. Matrix fixtures for every representable scan/publish/
association state were inserted by raw SQL **in the disposable DB only** (states
like specific `scan_status` values, an absent scan row, wrong-folder placement,
future publish dates, and `is_download=false` cannot be produced through the API
with uploads disabled). Runtime reads execute as `gm_directus`.

- **Public download route (`GET /gm-library/downloads/:fileId`, anonymous):** all
  16 states probed. Every unsafe state — missing scan row, `PENDING`,
  `THREATS_FOUND`, `FAILED`, `UNSUPPORTED`, `ACCESS_DENIED`, clean-but-draft,
  clean-but-archived, clean-but-future-dated, `is_download=false`, no submission
  association, `STAFF_MANAGED` origin, clean-in-Public-folder-without-association,
  threat-in-Clean-Review-folder — returns `404` with a byte-identical
  `{"error":"not_found"}` body (no leak of which condition failed). Only the fully
  eligible state (`NO_THREATS_FOUND` + `PUBLIC_SUBMISSION` + published + `published_at<=now`
  + `is_download=true` + submission association) returns `200` and streams the file.
  Folder placement never affects this route — it re-checks live DB state.
- **Anonymous `/assets/:id`:** `403` for all 16 files including the eligible one
  (public delivery flows only through the custom route).
- **Detail route (`GET /gm-library/items/:slug`, anonymous):** lists a downloadable
  file only for the eligible state; every unsafe state yields `files: []`, and an
  unpublished item is `404`.
- **Idempotency / info-leak:** repeated eligible download is stably `200`; denial
  bodies are identical across all reasons.

### Defect found and fixed (PR #9, not yet deployed)
The `gm-publish-gate` manual "move to Public Downloads folder" guard registered the
Directus event `directus_files.items.update`, which Directus never emits: for the
`directus_files` **system** collection the hook scope is `files.update` (no
`directus_` prefix, no `.items` infix). The guard was dead code — a staff user
could move any file (incl. `STAFF_MANAGED` or a `THREATS_FOUND` public submission)
straight into the Public Downloads folder. This was **not** an anonymous
public-exposure hole (the download route and revoked `/assets` are folder-independent,
proven above), but a broken documented control. Fix registers `files.update`; verified
in the disposable that `STAFF_MANAGED->Public` and `THREATS->Public` now return `422`
and the file stays out of Public, while the eligible file is still allowed. A regression
test asserts the real event name is registered.

### Not exercisable in the disposable (stated blockers)
- The **collection-mutation** folder hooks (`content_item{,_file}.items.*`) require
  `content_item`/`content_item_file` to be registered Directus collections. This repo
  ships **no Directus schema snapshot**, and Directus 12 does not auto-register existing
  Postgres tables, so those `/items/*` routes are not reachable from a clean bootstrap
  (0 registered collections). Their event names are correct (verified against the
  Directus source) and their logic is covered by the `gm-publish-gate` unit truth table.
- The **S3 version/ETag** fail-closed branch (`GM_PUBLIC_DOWNLOAD_REQUIRE_VERSION/ETAG`)
  is `s3`-storage only; the disposable used `local` storage, so it was not exercised
  here (covered by the committed MinIO integration test + unit logic).
- Unit suites: 72/72 pure-logic tests pass (`node --test`), including the new
  `files.update` regression guard.

## PR #9 merged and verified in production (2026-08-04)

- **PR #9** (`fix/publish-gate-files-event`) reviewed and squash-merged to `main` as
  `eb77a00`. Files changed: `gm-publish-gate/src/index.js`, its `test/hook.test.mjs`, and
  this handoff doc. Original branch fix commit: `05e8827`.
- **Incorrect -> corrected event name:** `directus_files.items.update` -> `files.update`.
  Directus derives a hook's scope from the collection; for the `directus_files` SYSTEM
  collection it strips the `directus_` prefix and omits the `.items` infix
  (`ItemsService`: `eventScope = isSystemCollection(collection) ? collection.substring(9) : "items"`),
  so file updates emit `files.update`. The old registration never fired.
- **Why the original unit test missed it:** the test fetched the handler by the same wrong
  name (`registered(state).get('directus_files.items.update')`), so it exercised the handler
  in isolation and stayed green regardless of the real Directus event dispatch. A new
  regression test now asserts `files.update` IS registered and `directus_files.items.update`
  is NOT, plus that the user-collection hooks keep `<collection>.items.<action>`.
- **Disposable before/after** (PG18 + Directus 12.0.2, gating ON): before the fix,
  `STAFF_MANAGED->Public` and `THREATS_FOUND->Public` returned `200` (dead guard); after,
  both return `422` and the file stays out of Public, while the fully eligible clean-public
  file is allowed to `200`. 16-fixture anonymous download matrix and unit suite (72/72) green.
- **Production deploy:** the fix went live via Render `dep-d9p643jbc2fs73a3nkkg` (commit
  `eb77a00`, trigger `new_commit`, live 22:08Z). It was then superseded by
  `dep-d9p71o49v7es73d6jhq0` (commit `ade03e2` — the unrelated PR #4 handoff-gaps merge,
  live 23:19Z), which **preserved** the fix. **Current production runtime commit: `ade03e2`**;
  `files.update` present, `directus_files.items.update` absent. Six extensions load; no gate errors.
- **Production rejected-mutation proof (one intentional attempt):** authenticated
  `PATCH /files/464be434-6516-4835-8527-76bb85307eaf` -> Public Downloads returned **`422`**
  (`PUBLIC_FILE_GATE_FAILED`, reason "manual public folder placement is not allowed"). The
  file was unchanged: still in `Clean Staff Review`, `modified_on` untouched, scan
  `NO_THREATS_FOUND`/`STAFF_MANAGED`, no content association created, anonymous
  `/assets/<id>` `403`, `/gm-library/downloads/<id>` `404`.
- **Public download boundary remains fail-closed**, and the manual-folder-override guard is
  now live and enforcing.
- **No production side effects:** `directus_files=1`, `file_scan=1`, `submission_file=0`;
  main queue and DLQ `0/0/0`; DLQ alarm `OK`; S3 holds only the retained clean object and
  the GuardDuty validation object; flags unchanged
  (`GM_SCAN_GATING_ENABLED=true`, `GM_SCAN_CONSUMER_ENABLED=true`,
  `GM_PUBLIC_FILE_UPLOADS_ENABLED=false`, `GM_STAFF_FILE_UPLOADS_ENABLED=false`,
  `GM_TEST_MODE=false`).

### Remaining certification gaps (scan gating is NOT yet fully certified)
- No disposable Directus collection registration / bootstrap schema snapshot, so the
  collection-level `content_item{,_file}.items.*` hooks are not exercised end to end.
- Review / promotion / publication editorial flows not yet exercised end to end in a
  disposable environment.
- The S3 version/ETag mismatch fail-closed branch not yet exercised end to end.
- The production threat-positive (`THREATS_FOUND`) GuardDuty test still pending explicit
  approval of the exact harmless test artifact and procedure.
