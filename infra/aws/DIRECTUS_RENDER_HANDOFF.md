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
