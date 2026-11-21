# GitHub → AWS EC2 backend code synchronization

## Purpose

This **opt-in** path removes the need for repeated AWS Systems Manager
Run Command steps whenever CRC private backend Python code changes.

GitHub branch: `feat/backend-bootstrap`
AWS region: `eu-north-1`
Only existing instance: `i-0d4cbc63a5953cf14`
Worktree: `/opt/clash-royale-companion/backend`

**Scope: safe code synchronization only.** It does not install or restart
systemd, migrate PostgreSQL, read or print OpenRouter keys, start a beta
gateway, publish the frontend, enable AI, or merge to `main`.

## Setup: one-time owner-approved AWS permissions (no recurring Run Commands)

1. In AWS Stockholm, use the CloudFormation template
   `deploy/infra/aws-github-backend-sync.review.json` after checking its
   exact document and IAM actions. This creates **only** a custom SSM command
   document and a dedicated GitHub OIDC IAM role. It does not create EC2,
   networks, databases, paid storage, or subscriptions.
2. Set the template parameter `GitHubOidcProviderArn` to an *already
   existing* GitHub OIDC provider ARN for your AWS account. If your AWS
   account does not yet have this provider, create/authorize it once
   separately; do not duplicate an existing shared OIDC provider.
3. In GitHub repository **Settings → Secrets and variables → Actions →
   Variables** set:
   - `AWS_CRC_BACKEND_SYNC_ROLE_ARN` to CloudFormation output
     `BackendSyncRoleArn`
   - `CRC_BACKEND_AUTOSYNC` to `enabled`
4. Push new code on `feat/backend-bootstrap` or manually run
   **CRC private backend GitHub to EC2 sync** on that branch.

No long-lived AWS access keys or private OpenRouter secrets belong in
GitHub. Keep the existing `AWS_CRC_OIDC_ROLE_ARN` read-only role
and the unrelated `loomera-beta` EC2 untouched.

## Runtime guarantees

- GitHub Actions runs the backend tests first, with an ephemeral PostgreSQL
  test database. An error prevents the AWS sync job.
- GitHub obtains short-lived AWS credentials with OIDC, restricted to the
  exact repo branch.
- The new role may invoke **only** `CRC-Sync-Private-Backend` on the
  exact existing CRC EC2 instance in Stockholm; it cannot invoke the
  general `AWS-RunShellScript` document or modify other EC2 instances.
- The custom SSM document receives only a forty-character Git SHA. Its
  shell script is pinned to that commit and runs as `ec2-user`.
- The checkout must be clean, on the exact backend branch and GitHub origin.
  Only a fast-forward update that matches the tested GitHub SHA is allowed.
- Before merging, the server checks Python source syntax from the exact
  commit and `git diff --check`.
- The document is a one-shot sync. It does **not** install a new persistent
  agent, and a failed sync does not install or restart the beta service.

## Important remaining work

The `crc-private-beta.service` is not yet installed. GitHub code sync does
**not** make the beta backend accessible. Starting this service will later
need a separately reviewed, gated release process with complete Cloudflare
Access, same-origin routing, PostgreSQL TLS validation, daily AI quota
migration, and rollout/rollback. The existing AI switch
`CRC_BETA_AI_ENABLED=false` remains unchanged.

To pause future syncs, set `CRC_BACKEND_AUTOSYNC=disabled` in GitHub
Actions repository variables. This needs no EC2 access.
