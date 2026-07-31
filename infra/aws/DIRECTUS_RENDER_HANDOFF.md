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
  everyone except the GuardDuty role). So a freshly uploaded file may be briefly
  unreadable (typically seconds to a couple of minutes) until the scan completes.
- Application code that serves attachments must handle a temporary "not yet available /
  pending scan" state, and must treat a non-clean object as unavailable.

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
