# Gathering Matters storage security (AWS)

Reproducible infrastructure for secure Directus file storage on AWS: a private S3
media bucket, GuardDuty Malware Protection for S3 (independent feature), tag-based
clean-file access enforcement, a least-privilege Directus IAM application user, and
malware plus cost alerting.

- **Template:** `storage-security.yaml`
- **Stack name:** `gathering-matters-storage-security`
- **Account:** `025452941754` · **Region:** `us-west-2`
- **Resource tags:** `Project=GatheringMatters`, `Environment=Production`, `ManagedBy=CloudFormation`

## What the stack creates

| Resource | Purpose |
|---|---|
| `AWS::S3::Bucket` `gathering-matters-directus-media-025452941754-us-west-2` | Private media bucket: BucketOwnerEnforced, all Block Public Access on, SSE-S3 (AES256), versioning, lifecycle (abort incomplete MPU after 7d, expire noncurrent versions after 90d). `DeletionPolicy: RetainExceptOnCreate`, `UpdateReplacePolicy: Retain`. |
| `AWS::S3::BucketPolicy` | TLS-only deny, plus tag-based access control (TBAC): denies reads unless `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`, and denies anyone except the GuardDuty role from setting that tag. |
| `AWS::IAM::Role` `gm-guardduty-malware-protection-s3-role` | GuardDuty Malware Protection service role (verbatim AWS-documented least-privilege policy; KMS statement omitted because the bucket is SSE-S3, not KMS). |
| `AWS::GuardDuty::MalwareProtectionPlan` | Independent Malware Protection plan for the whole bucket, scan-result tagging ENABLED. No detector, no other protection plans. |
| `AWS::IAM::User` `gm-directus-s3-app` | Directus application identity: no console, no IAM/GuardDuty perms, bucket-scoped S3 only, cannot set the scan tag. |
| `AWS::SNS::Topic` + Subscription + TopicPolicy | `gathering-matters-s3-malware-alerts`, email subscription (needs confirmation), EventBridge publish permission. |
| `AWS::Events::Rule` | Alerts on scan results needing attention (`THREATS_FOUND`, `UNSUPPORTED`, `ACCESS_DENIED`, `FAILED`); not `NO_THREATS_FOUND`. |
| `AWS::Budgets::Budget` `GatheringMatters-Monthly-AWS-Budget` | $10/month; alerts at 50/80/100% actual and 100% forecast. |

The application access key for `gm-directus-s3-app` is **not** in this template. It is
created separately, once, after deploy and verification, and stored outside the repo
(see the handoff doc). Never commit secrets.

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
- The bucket is retained on stack deletion (`RetainExceptOnCreate` / `UpdateReplacePolicy: Retain`).
  To remove it intentionally, empty it (objects + all versions + delete-markers +
  incomplete multipart uploads) and then `s3api delete-bucket`. Never delete production data without approval.
- Deactivate/delete the `gm-directus-s3-app` access key and user; the SNS topic,
  EventBridge rule, and budget are removed with the stack.
