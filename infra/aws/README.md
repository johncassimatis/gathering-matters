# Gathering Matters storage security (AWS)

Reproducible infrastructure for secure Directus file storage on AWS: a private S3
media bucket, GuardDuty Malware Protection for S3 (independent feature), tag-based
clean-file access enforcement, a least-privilege Directus IAM application user, and
malware plus cost alerting.

> **⚠ NOT DEPLOY-READY.** Confirmed from Directus 12.0.2 source that `FilesService.uploadOne()`
> reads the uploaded object during upload (`stat()`/`HeadObject` for every file; images also
> `read()`/`GetObject`) **before** GuardDuty can tag it, so the `NoReadUnlessClean` deny would
> break Directus uploads. Blocked on the scan-architecture decision (Option A vs Option B) and
> the AWS Paid-plan upgrade. Option A is now the selected repository architecture: the Directus
> application identity is exempted from the object-read deny, while anonymous distribution is
> removed from raw `/assets` and served through `/gm-library/downloads/:fileId`. The policy is
> not deploy-ready until V009, extension rollout, explicit `--revoke-public-assets`, and live
> verification are complete.
> See `gathering-matters-db/docs/s3-scan-gating-design.md` §2 and §2a.

- **Template:** `storage-security.yaml`
- **Stack name:** `gathering-matters-storage-security`
- **Account:** `025452941754` · **Region:** `us-west-2`
- **Resource tags:** `Project=GatheringMatters`, `Environment=Production`, `ManagedBy=CloudFormation`

## What the stack creates

| Resource | Purpose |
|---|---|
| `AWS::S3::Bucket` `gathering-matters-directus-media-025452941754-us-west-2` | Private media bucket: BucketOwnerEnforced, all Block Public Access on, SSE-S3 (AES256), versioning, lifecycle (abort incomplete MPU after 7d, expire noncurrent versions after 90d). `DeletionPolicy: RetainExceptOnCreate`, `UpdateReplacePolicy: Retain`. |
| `AWS::S3::BucketPolicy` | TLS-only deny, plus tag-based access control (TBAC): denies reads unless `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` except the GuardDuty and Directus application identities, and denies anyone except GuardDuty from setting that tag. Public delivery is application-gated. |
| `AWS::IAM::Role` `gm-guardduty-malware-protection-s3-role` | GuardDuty Malware Protection service role (verbatim AWS-documented least-privilege policy; KMS statement omitted because the bucket is SSE-S3, not KMS). |
| `AWS::GuardDuty::MalwareProtectionPlan` | Independent Malware Protection plan for the whole bucket, scan-result tagging ENABLED. No detector, no other protection plans. |
| `AWS::IAM::User` `gm-directus-s3-app` | Directus application identity: no console, no IAM/GuardDuty perms, bucket-scoped S3 only, cannot set the scan tag. |
| `AWS::SNS::Topic` + Subscription + TopicPolicy | `gathering-matters-s3-malware-alerts`, email subscription (needs confirmation), EventBridge publish permission. |
| `AWS::Events::Rule` | Alerts on scan results needing attention (`THREATS_FOUND`, `UNSUPPORTED`, `ACCESS_DENIED`, `FAILED`); not `NO_THREATS_FOUND`. |
| `AWS::Budgets::Budget` `GatheringMatters-Monthly-AWS-Budget` | $10/month; alerts at 50/80/100% actual and 100% forecast. |

The application access key for `gm-directus-s3-app` is **not** in this template. It is
created separately, once, after deploy and verification, and stored outside the repo
(see the handoff doc). Never commit secrets.

## Option A application boundary

Directus must be able to perform its upload-time `HeadObject`/metadata reads, so the
application identity remains technically able to read the private bucket. Public documents
are not exposed through anonymous `/assets/:id`. When scan gating is enabled:

- `gm-library` lists only `PUBLIC_SUBMISSION` files with `NO_THREATS_FOUND`, published
  content, and an explicit downloadable association.
- `/gm-library/downloads/:fileId` repeats those checks at request time and verifies the
  recorded S3 version/ETag before streaming; revocation invalidates old links.
- trusted staff-managed featured media uses `/gm-library/media/:fileId` and is classified
  separately from public submissions.
- `tools/provision-scan-file-permissions.mjs --revoke-public-assets` removes only the exact
  earlier managed anonymous policy. It has not been run in this task.

The bucket remains private, blocks direct public access, and protects non-Directus
principals with the GuardDuty scan tag. Option B is required if true quarantine is mandatory.

## Prerequisite: account must be on the AWS Paid plan

GuardDuty is not available on the AWS Free account plan; `CreateMalwareProtectionPlan`
returns `SubscriptionRequiredException` until the account is upgraded to the Paid plan
(pay-as-you-go; remaining Free Tier credits still apply). This is an account-owner
action in Billing and Cost Management (Upgrade plan -> Upgrade account). This stack does
NOT enable full GuardDuty, a detector, or `AWSServiceRoleForAmazonGuardDuty`.

## Authenticate

```powershell
aws configure set region us-west-2
aws login --region us-west-2          # browser flow; no access keys
aws sts get-caller-identity           # expect account 025452941754, user/engineering-admin (not root)
```

On this Windows host, set `$env:PYTHONUTF8 = '1'` before AWS CLI calls to avoid a
console Unicode crash, and prepend the CLI dir to PATH if needed:
`C:\Users\Pierc\AppData\Local\Programs\Amazon\AWSCLIV2`.

## Validate before deploy

```powershell
cfn-lint storage-security.yaml
aws cloudformation validate-template --template-body file://storage-security.yaml --region us-west-2
# preview as a change set and review the summary before executing
aws cloudformation create-change-set --stack-name gathering-matters-storage-security `
  --change-set-name review --change-set-type CREATE `
  --template-body file://storage-security.yaml --capabilities CAPABILITY_NAMED_IAM --region us-west-2
aws cloudformation describe-change-set --stack-name gathering-matters-storage-security `
  --change-set-name review --region us-west-2 `
  --query "Changes[].ResourceChange.{Action:Action,Type:ResourceType,Id:LogicalResourceId}" --output table
```

Confirm the change set creates **no** `AWS::GuardDuty::Detector`, no
`AWSServiceRoleForAmazonGuardDuty`, and no EC2/Runtime-Monitoring/EKS/ECS/RDS/Lambda
GuardDuty resources. Then execute the change set (or `create-stack`).

## Deploy

```powershell
aws cloudformation create-stack --stack-name gathering-matters-storage-security `
  --template-body file://storage-security.yaml --capabilities CAPABILITY_NAMED_IAM --region us-west-2 `
  --tags Key=Project,Value=GatheringMatters Key=Environment,Value=Production Key=ManagedBy,Value=CloudFormation
aws cloudformation wait stack-create-complete --stack-name gathering-matters-storage-security --region us-west-2
```

The GuardDuty Malware Protection plan must reach `ACTIVE`. The SNS email subscription
starts as `PendingConfirmation` and must be confirmed from the recipient inbox.

## Rollback / teardown

- Delete the stack: `aws cloudformation delete-stack --stack-name gathering-matters-storage-security --region us-west-2`.
- The bucket is retained on a later stack **deletion or replacement** (`RetainExceptOnCreate`
  behaves like `Retain` once the resource exists; `UpdateReplacePolicy: Retain` covers replacement).
  The one exception is a **rollback of the INITIAL stack create**: `RetainExceptOnCreate` deletes the
  just-created bucket in that case (by design, so a failed first deploy does not orphan an empty
  bucket). Since this stack is now `CREATE_COMPLETE`, the bucket is retained from here on.
  To remove it intentionally, empty it (objects + all versions + delete-markers +
  incomplete multipart uploads) and then `s3api delete-bucket`. Never delete production data without approval.
- Deactivate/delete the `gm-directus-s3-app` access key and user; the SNS topic,
  EventBridge rule, and budget are removed with the stack.
