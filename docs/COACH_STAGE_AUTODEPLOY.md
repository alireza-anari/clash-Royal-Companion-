# CRC Coach staging: GitHub -> Cloudflare (opt-in)

This document describes a **sample-only** staging deployment for the
`feat/mvp-coach-offline` branch. It is NOT a live Supercell backend deployment.

## Fixed infrastructure

- Account: `2e4e0d025c81b9134fd2d19f17535e30`
- Target Worker: `crc-coach-ci-stage-20261121`
- Expected URL (when Cloudflare DNS has propagated):
  `https://crc-coach-ci-stage-20261121.alirezaanari117.workers.dev/`
- Old site `crc-mvp-stage-20261120` remains unchanged.
- Private gateway `crc-private-beta-gateway`, Cloudflare Tunnel, EC2 FastAPI,
  and PostgreSQL are not touched by staging updates.

## One-time GitHub configuration (web UI)

1. On Cloudflare dashboard, create a **Custom API Token** with only account
   Workers Scripts **Edit** permission (or narrower per-Worker Edit if offered),
   restricting to the intended account. Do **not** use the Global API Key,
   a GitHub PAT, or send the token to chat.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions**.
   Set the repository secret `CRC_CLOUDFLARE_API_TOKEN` to that Cloudflare token.
3. Add the repository **variable**
   `CRC_CLOUDFLARE_ACCOUNT_ID` = `2e4e0d025c81b9134fd2d19f17535e30`.
4. Add repository **variable** `CRC_STAGE_AUTODEPLOY` = `enabled`.
   Until enabled, the deploy job is skipped while checks run normally.
5. Optional: Configure **Settings > Environments > crc-coach-stage** with
   required reviewers for a manual approval before each deployment.

## Workflow

`.github/workflows/coach-stage-autodeploy.yml`

- Runs for pushes to `feat/mvp-coach-offline`.
- Validates JavaScript syntax, complete deterministic tests, reproducible bundle,
  and guard assertions for disabled live player lookup.
- Uses the **Cloudflare REST API** to upload only
  `deploy/cloudflare/mvp-worker.js` to the **fixed separate Worker**.
- Does not deploy `main`, does not merge PRs, and does not send any player data.
- GitHub job success with `deploy: skipped` means opt-in is still disabled;
  it is **not evidence of a published update**.

## Rollback and limitations

To pause automatic publication: change repository variable
`CRC_STAGE_AUTODEPLOY` to `disabled` (or remove it).
The installed EC2 frontend sync is separate; pausing Cloudflare publication
does not stop EC2 file sync. To roll back a published Worker, use the
Cloudflare **Deployments / Versions** interface for the dedicated staging Worker,
or redeploy a previously verified commit.

GitHub-hosted code and third-party GitHub Actions are part of the trust boundary.
Do not store Supercell API keys, PostgreSQL secrets, Cloudflare Tunnel tokens,
or personal battle logs in GitHub repository files or Actions logs.

**Important**: Changing a GitHub Actions variable does not itself trigger a
new push. After enabling the variables/secret, a new commit on the branch is
needed for the first automatic publication.
