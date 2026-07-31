# AWS S3 + GuardDuty Malware Protection — Implementation Continuation

**Purpose:** Phase 1 (Agent Toolkit setup) is complete. The Agent Toolkit installed an AWS MCP
server into `~/.claude.json`, which requires a **new session** to activate. Resume here from
**Phase 2** in the next session. Read this whole file first.

---

## CURRENT STATUS / RESUME POINT (updated)

**Root cause of the earlier failure is confirmed to be the AWS Free account plan, NOT a
standalone-onboarding gap.** `CreateMalwareProtectionPlan` returns `SubscriptionRequiredException`
because account `025452941754` is on the new AWS **Free account plan**, which blocks paid services
like GuardDuty (billing console shows Upgrade plan, ~$120 credits, 182 days, cost/forecast Access
denied). Verified against official AWS docs (Billing "Choosing a plan"). Fix = the **account owner
upgrades to the Paid account plan** (Billing and Cost Management -> Upgrade plan -> Upgrade account;
pay-as-you-go, no subscription fee, remaining credits still apply). This is the only account-owner
action needed. Do NOT enable full GuardDuty, a detector, or `AWSServiceRoleForAmazonGuardDuty`.

**Account is now a CLEAN SLATE** (meantime cleanup done, verified): the failed `ROLLBACK_COMPLETE`
stack was deleted, and the empty orphaned bucket (verified 0 objects / 0 versions / 0 delete-markers
/ 0 incomplete MPUs) was deleted. `list-buckets` returns `[]`. No detector, no SLR, no MP plan, no
IAM role/user. Nothing GuardDuty enabled.

**Template is ready and re-validated:** `infra/aws/storage-security.yaml` now uses
`DeletionPolicy: RetainExceptOnCreate` + `UpdateReplacePolicy: Retain` on the bucket. cfn-lint exit 0,
`validate-template` exit 0 (needs `CAPABILITY_NAMED_IAM`). Docs written: `infra/aws/README.md`,
`infra/aws/DIRECTUS_RENDER_HANDOFF.md`.

**Resume steps once the account shows the Paid plan:**
1. Reverify identity/account (`sts get-caller-identity` = 025452941754 / user/engineering-admin).
2. Confirm no longer restricted: `aws guardduty list-detectors --region us-west-2` should now
   succeed (return a list, likely empty `[]`) instead of `SubscriptionRequiredException`. Confirm no
   detector / no broader plan / no SLR were created by the upgrade.
3. If `CreateMalwareProtectionPlan` still fails, the standalone console onboarding (Malware Protection
   for S3 only -> Get started, NOT All features) may still be needed; do that, then retry. If it still
   fails, STOP and report the exact API call, CFN event, error, Region, and CloudTrail event; do not
   enable full GuardDuty or create any SLR without approval.
4. cfn-lint + validate-template + create-change-set; show the change-set summary and confirm it
   creates NO `AWS::GuardDuty::Detector`, NO `AWSServiceRoleForAmazonGuardDuty`, and no
   EC2/Runtime-Monitoring/EKS/ECS/RDS/Lambda GuardDuty resources.
5. Deploy (Phase 3), then continue Phases 4-8 + verification. Access key (Phase 6) is created last.

---

## Environment & hard constraints (do not violate)

- **This is the PRODUCTION Gathering Matters AWS account.**
- **Account ID:** `025452941754`
- **Authenticated identity:** `arn:aws:iam::025452941754:user/engineering-admin` (engineering
  admin IAM user — NOT root). Re-verify with `aws sts get-caller-identity` before any change.
  If the account or identity differs, **STOP** and make no changes.
- **Default & workload Region:** `us-west-2`. Use `us-east-1` ONLY for `aws agent-toolkit` commands.
- Authenticate ONLY via the `aws login` browser flow. **Never** read/use any local AWS credential file on the operator machine.
  **Never** request or use root or engineering access keys. `aws login` sessions last 12h
  (refreshable 90 days); if expired, run `aws login --region us-west-2` again.
- **Do NOT modify the running Directus or Render deployment.** Build & verify AWS infra only.
- **Do NOT** create another AWS account, root user, admin user, or engineering login.
- **Do NOT** enable unrelated GuardDuty protection plans. Use **Malware Protection for S3** as an
  independent feature unless full GuardDuty is explicitly approved.
- **Do NOT** delete/replace existing resources. Reuse/update correct existing ones; report conflicts first.

### Windows/tooling notes discovered in Phase 1
- `aws` CLI v2.36.12 installed user-local at `C:\Users\Pierc\AppData\Local\Programs\Amazon\AWSCLIV2`.
  A fresh session should have it on PATH; if not, prepend that dir to `$env:Path`.
- **Set `$env:PYTHONUTF8 = '1'`** (Python UTF-8 mode) before agent-toolkit/CLI calls — the frozen
  AWS CLI otherwise crashes (exit 255, `'charmap' codec can't encode '→'`) on Unicode in some
  outputs. `PYTHONIOENCODING=utf-8` alone is NOT enough; `PYTHONUTF8=1` is the working fix. Also
  `chcp 65001`. Verified: `list-available-skills` then exits 0 with 91 skills.
- Prefer `--output json` and, for large output, redirect via `Start-Process ... -RedirectStandardOutput`
  to a file; avoid `ConvertFrom-Json` in PS 5.1 (it mangles on encoding edge cases).

### Phase 1 completed (for the record)
OS detected (Windows_NT) · AWS CLI v2.36.12 installed (MSI Authenticode verified) · region set to
`us-west-2` · `aws login` browser auth OK · identity verified (above) · `aws configure agent-toolkit
--yes --region us-east-1` installed 16 skills + MCP for Claude Code · `aws agent-toolkit
list-available-skills --region us-east-1` returned the catalog.

---

## Goal
Secure file storage for Gathering Matters Directus using: (1) private S3 bucket, (2) GuardDuty
Malware Protection for S3, (3) scan-result tagging + clean-file access enforcement, (4) least-priv
IAM app user for Directus, (5) security & cost alerts, (6) documented Render/Directus handoff.

Prefer the installed AWS skills (`aws-cloudformation`, `aws-billing-and-cost-management`,
`aws-messaging-and-streaming`, `aws-observability`, `aws-sdk-*`) and the AWS MCP server for
authoritative, current API/CFN shapes. Use `aws-cloudformation` skill guidance for template
authoring + validation (cfn-lint/guard/change-sets).

---

## Phase 2 — Inspect the existing account (READ-ONLY; no changes)
Inspect and report before creating anything:
- Existing S3 buckets (`aws s3api list-buckets`)
- Existing GuardDuty Malware Protection plans (`aws guardduty list-malware-protection-plans`)
- Existing GuardDuty detectors (`aws guardduty list-detectors`)
- IAM users/roles/policies related to Directus or S3
- AWS Budgets (`aws budgets describe-budgets --account-id 025452941754`)
- SNS topics / EventBridge rules for security alerts
- CloudFormation stacks related to Gathering Matters
Reuse/update correct existing resources instead of duplicating. Report conflicts before proceeding.

---

## Phase 3 — Reproducible infrastructure (CloudFormation)
Create `infra/aws/storage-security.yaml` and `infra/aws/README.md`.
Stack name: **`gathering-matters-storage-security`**. Tags where supported:
`Project=GatheringMatters`, `Environment=Production`, `ManagedBy=CloudFormation`.
**Validate the template before deploy** (cfn-lint / `aws cloudformation validate-template` / change set).

### S3 bucket
Name: `gathering-matters-directus-media-025452941754-us-west-2` (pattern: `...-<ACCOUNT_ID>-us-west-2`).
- Region `us-west-2`
- Object Ownership: `BucketOwnerEnforced`
- All four Block Public Access settings = true
- No public bucket policy; no public ACLs
- Default SSE-S3 (`AES256`)
- Versioning enabled
- Bucket policy: **deny non-TLS** requests (`aws:SecureTransport=false`)
- Lifecycle: abort incomplete multipart uploads after 7 days
- Optional: expire noncurrent versions after 90 days
- **No** expiration of current production objects
- `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`
- NO static website hosting. NO permissive CORS (backend-only; add CORS only if inspection proves needed).

### GuardDuty Malware Protection for S3
- Dedicated IAM **service role** for GuardDuty MP with current AWS-documented trust policy + least-priv
  perms to: validate bucket ownership, monitor new uploads, read objects for scanning, add the
  `GuardDutyMalwareScanStatus` tag, create/manage the required EventBridge-managed rule, upload the
  GuardDuty validation object, and use the bucket's SSE (AES256/SSE-S3).
- `AWS::GuardDuty::MalwareProtectionPlan` for the **entire bucket**:
  - Protected bucket = the new media bucket
  - Object scan-result **tagging: enabled**
  - No prefix restriction unless a reliable Directus upload prefix is established by inspection
  - Plan status must reach **`ACTIVE`**
- Tag key: `GuardDutyMalwareScanStatus`; values: `NO_THREATS_FOUND`, `THREATS_FOUND`, `UNSUPPORTED`,
  `ACCESS_DENIED`, `FAILED`.

### Clean-file access enforcement (bucket policy)
AWS-recommended tag-based access control. The policy must:
1. **Deny** `s3:GetObject` + `s3:GetObjectVersion` for objects NOT tagged
   `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`.
2. Exempt ONLY the GuardDuty scanning role where needed (so it can read unscanned objects).
3. Prevent all other principals (incl. the Directus app user) from setting/modifying the
   `GuardDutyMalwareScanStatus` tag.
4. Still allow deletes by an authorized admin or the scoped Directus identity.
Directus/public must NOT read objects that are: awaiting scan, `THREATS_FOUND`, `UNSUPPORTED`,
`ACCESS_DENIED`, or `FAILED`. Tagging + this policy must be active **before** production uploads.

---

## Phase 4 — Directus application identity
IAM user **`gm-directus-s3-app`**:
- No console access; no admin; no IAM perms; no GuardDuty perms
- Access limited to the new bucket only; no other buckets; cannot alter the scan-result tag
- Grant only: bucket-level `s3:GetBucketLocation`, `s3:ListBucket`, `s3:ListBucketMultipartUploads`;
  object-level `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:DeleteObject`,
  `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`.
- Do NOT grant `s3:*`, `iam:*`, `guardduty:*`, `s3:PutObjectAcl`, `s3:PutBucketPolicy`, or any ability
  to set/overwrite `GuardDutyMalwareScanStatus`.
- Clean-file bucket policy still gates this user's reads until `NO_THREATS_FOUND`.
- Verify allowed AND denied actions with IAM policy simulation (`aws iam simulate-principal-policy`).

---

## Phase 5 — Alerts & cost controls
### Malware-scan alerts
- SNS topic **`gathering-matters-s3-malware-alerts`**; subscribe `engineering@gatheringmatters.com`.
- EventBridge rule for GuardDuty MP object-scan results needing attention: `THREATS_FOUND`,
  `UNSUPPORTED`, `ACCESS_DENIED`, `FAILED`. Do NOT alert on `NO_THREATS_FOUND`. Use current
  AWS-documented event structure; handle duplicate events safely.
- **Report that the SNS email subscription must be confirmed from the recipient inbox.**

### Budget
- Monthly cost budget **`GatheringMatters-Monthly-AWS-Budget`**, amount **$10**, notify
  `engineering@gatheringmatters.com` at **50% / 80% / 100% actual** and **100% forecasted**.
- No automatic action that disables/deletes production resources.

---

## Phase 6 — Application access key (only after all infra deployed & verified)
- Create **one** active access key for `gm-directus-s3-app`.
- **Never** print the secret in chat; never commit it; never put it in the CFN template/params/outputs/docs.
- Save credentials to a local file **outside the repo** with owner-only permissions; report only the
  **file path** and the **access-key ID**.
- Tell the user to copy values into Render secret env vars, then securely delete the local file.
- If secure local storage is unavailable, STOP before creating the key.

---

## Phase 7 — Verification (document results)
**Infra:** bucket in us-west-2; BPA fully on; ACLs disabled (BucketOwnerEnforced); default encryption
on; versioning on; TLS-only enforced; CFN stack healthy; GuardDuty MP plan `ACTIVE`; tagging enabled;
Directus user has no console login; Directus policy limited to the new bucket; budget & alert resources exist.

**Clean-object test** (using the Directus identity): upload a harmless text file → confirm it CANNOT be
read while unscanned → poll tags until scan completes → confirm `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`
→ confirm it can then be read → confirm the Directus identity CANNOT overwrite the scan-status tag → delete
the test object. **Do NOT upload live malware. Do NOT use EICAR unless the user explicitly approves.**

**Negative permission tests** (Directus identity must FAIL to): list unrelated buckets; read/write another
bucket; change bucket policy; change GuardDuty config; create IAM resources; make an object public; set the
scan-result tag; read an unscanned/non-clean object.

---

## Phase 8 — Directus/Render handoff (no Render changes)
Create `infra/aws/DIRECTUS_RENDER_HANDOFF.md` with placeholders (NO real secret):
```env
STORAGE_LOCATIONS=s3
STORAGE_S3_DRIVER=s3
STORAGE_S3_KEY=<AWS_ACCESS_KEY_ID>
STORAGE_S3_SECRET=<AWS_SECRET_ACCESS_KEY>
STORAGE_S3_BUCKET=<CREATED_BUCKET_NAME>
STORAGE_S3_REGION=us-west-2
STORAGE_S3_SERVER_SIDE_ENCRYPTION=AES256
```
Also document: SNS confirmation requirement; how long a new upload may be unavailable while scanning; how
to inspect `GuardDutyMalwareScanStatus`; what each status means; how to rotate the Directus key; how to
disable a compromised key; how to review/delete a malicious object safely; that existing Directus files are
NOT migrated by this task; that production Render vars must not change until a separate deployment window +
rollback plan exist.

---

## Final report (at completion)
Account ID & auth ARN (no secrets) · workload Region · CFN stack name & status · bucket name & ARN ·
GuardDuty MP plan ID/ARN/status · GuardDuty service-role ARN · Directus IAM user ARN · Directus policy ARN ·
app access-key ID only · secure local path holding the one-time secret · SNS topic ARN & subscription status ·
EventBridge rule name · budget name & thresholds · verification results · remaining manual steps · exact
rollback steps · any deviations from the prompt and why.

**Do not claim success unless resources exist and all feasible checks pass.** On any failure: report the
full error, stop dependent changes, leave existing production resources untouched.

### Rollback (high level, to detail in final report)
Primary teardown = delete the CFN stack `gathering-matters-storage-security` (bucket is `Retain`, so it
survives stack deletion and must be emptied+deleted manually if intended). Deactivate/delete the
`gm-directus-s3-app` access key and user. Delete SNS topic, EventBridge rule, and the budget. GuardDuty MP
plan is managed by the stack; confirm removal. Never delete production data without explicit approval.
