# SP-BETA-08 — GitHub → AWS OIDC without permanent access keys

**Status (22 November 2026): AWS OIDC trust is not connected. The existing EC2 host is user-managed; GitHub OIDC and SSM automation remain skipped until the owner installs the IAM bootstrap role and adds its ARN as a repository variable.**

Purpose: Replace the paid TinyFish browser workflow with native GitHub Actions → AWS short-lived OIDC sessions, initially **read-only**. This avoids putting an AWS password, IAM user access key, secret key, or MFA code in GitHub or in this conversation.

## Files committed

- `deploy/infra/aws-github-oidc-readonly.bootstrap.json`: CloudFormation template with an optional shared GitHub OIDC provider and one tightly scoped read-only IAM role.
- `.github/workflows/aws-oidc-readonly.yml`: branch-only `push` (and dormant manual dispatch) verification. It only runs AWS calls when repository variable `AWS_CRC_OIDC_ROLE_ARN` is set, and only on `feat/backend-bootstrap`.
- `api/tests/test_aws_github_oidc.py`: validates the exact audience/subject, private temporary session policy, role constraints, and no keys.
- `.github/workflows/backend-tests.yml`: validates both AWS infra candidates with `cfn-lint` offline; not an AWS deployment workflow.

## Security model

The IAM **trust policy** matches exactly:

```json
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:alireza-anari/clash-Royal-Companion-:ref:refs/heads/feat/backend-bootstrap"
  }
}
```

The role can only read EC2 inventory using a small explicit list of `ec2:Describe*` API actions scoped by `aws:RequestedRegion=eu-central-1`. It cannot create/delete instances or Elastic IPs, allocate volumes, update IAM, use Secrets Manager, read S3 buckets, access billing, upgrade the AWS account, or deploy. Its temporary session length is 15 minutes through GitHub Actions. AWS CLI outputs are parsed into **counts**, hiding AWS account IDs, VPC identifiers and public IPs from CI logs.

**Trusting a branch is still a security boundary:** anyone who can modify and push workflow code on `feat/backend-bootstrap` may be able to use the **read-only** role. Limit who can push, protect the branch if possible, review code changes and use a dedicated *different*, manually gated role for any later deployment. Avoid long-lived credentials entirely.

## Owner-only initial setup — no paid AWS infrastructure

**Step 1 — Create the IAM identity bridge in AWS (one-time).**

1. Sign in at [AWS CloudFormation](https://console.aws.amazon.com/cloudformation/home?region=eu-central-1). Verify the selected account and region are the intended AWS Free Plan account. Do **not** upgrade to Paid.
2. In **IAM → Identity providers**, look for an existing OIDC provider with URL `https://token.actions.githubusercontent.com`. **Do not create a duplicate** if it already exists; note its full *ARN* if present. The same provider can be shared among projects, but roles must have separate narrowly scoped trust.
3. Open `deploy/infra/aws-github-oidc-readonly.bootstrap.json` from the linked repository development branch, select **Raw**, download it as a local `.json` file. In **CloudFormation → Create stack → With new resources (standard) → Choose existing template → Upload a template file**, upload the JSON.
4. Stack name: `crc-github-oidc-readonly`. If the provider is absent, keep `ProviderMode=CREATE` and `ExistingProviderArn=NONE`. If already present, set `ProviderMode=EXISTING` and enter the existing **provider ARN**.
5. Review **Change set**. It must contain only `AWS::IAM::OIDCProvider` (if creating) and one `AWS::IAM::Role`. Never approve EC2/EBS/EIP/VPC/S3 or other resources in this stack. Approve IAM capabilities as asked by CloudFormation (**CAPABILITY_IAM**, because it creates an IAM role). Execute only after verifying the stack contents.
6. When the stack reaches `CREATE_COMPLETE`, open **Outputs** and copy **ReadOnlyRoleArn**. This ARN identifies a role; it is **not** an AWS Access Key or secret. Do not share your account number here.

**Step 2 — Bind just the ARN to this GitHub repository.**

1. Open repository [Actions variables](https://github.com/alireza-anari/clash-Royal-Companion-/settings/variables/actions).
2. Click **New repository variable** (under **Variables**, not **Secrets**).
3. Name exactly: `AWS_CRC_OIDC_ROLE_ARN`.
4. Value: paste the **ReadOnlyRoleArn** from CloudFormation Outputs. Save. No AWS password, MFA or IAM user keys should ever be saved here.

**Step 3 — Read-only test.**

The workflow `.github/workflows/aws-oidc-readonly.yml` triggers on **push to `feat/backend-bootstrap`**. At every push it is **skipped while the variable is unset**. After saving the variable, request a no-functional-change commit to that branch (we can do this in the same conversation), so the workflow starts. It will assume the role through short-lived OIDC and report only counts of existing Frankfurt EC2s/VPCs/subnets/EIPs.

The GitHub UI's **Run workflow** button for `workflow_dispatch` normally requires the workflow file on the **default branch**, but we have intentionally **not merged to `main`**. Use the branch push trigger instead until the owner separately approves merging. Do not merge simply to run OIDC tests.

**Success:** GitHub Actions shows `AWS OIDC read-only role verified; no changes made` and Frankfurt inventory counts. This verifies the temporary role, not the account's 50 USD credit balance: the IAM role deliberately has **no billing permissions**.

## Current boundaries

- IAM identity bridge: not installed in AWS, so **OIDC is not yet live**.
- No signed-in AWS Console session or direct AWS account connector is available in this project. The owner must complete the one-time IAM OIDC bootstrap and GitHub variable entry before AWS actions can run.
- The owner already has an EC2 host and PostgreSQL container. A separate Cloudflare private beta Worker and VPC Service are deployed but disabled; the Tunnel is down. The OIDC workflow has not launched or modified AWS resources.
- This role only establishes **read-only AWS visibility**. A later EC2 deployment requires a **different** role with minimal explicit infrastructure permissions, owner approval for spending AWS credits, cost estimate and rollback/teardown tests. Never expand this read-only role to `AdministratorAccess`.
- Public sample-only Cloudflare staging is separate and unchanged. Draft PR #2 remains unmerged.
- OIDC trust and policy must be audited again if the repo/branch name changes.

## Troubleshooting

- `Not authorized to perform sts:AssumeRoleWithWebIdentity`: check exact repo name (including final hyphen), branch `feat/backend-bootstrap`, audience `sts.amazonaws.com`, provider ARN and IAM role.
- `No OpenIDConnect provider found`: the IAM OIDC provider was not installed in the intended AWS account, or selected existing ARN is wrong.
- `AccessDenied` on EC2 Describe: ensure permissions policy is attached to this role and requests target Frankfurt (`eu-central-1`).
- Skipped workflow: check that `AWS_CRC_OIDC_ROLE_ARN` exists under repository **Variables**, and the latest commit is on `feat/backend-bootstrap`.
- IAM create stack failure: provider may already exist globally in the account; switch to `ProviderMode=EXISTING` after verifying the correct ARN, and don't delete other projects' existing provider.

## Official references

- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-oidcprovider.html
- https://github.com/aws-actions/configure-aws-credentials
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
