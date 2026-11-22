# SP-BETA-07 — AWS Free Plan EC2: reviewable infrastructure, zero actual deployment

**Current status (22 November 2026): an existing EC2 instance is already in use by the owner.** The owner reports AWS Free Plan and about US$50 in credits, but this is not independently verified. Do not launch a second instance or upgrade the account.

## What is implemented

`deploy/infra/aws-ec2-private-beta.review.json` is a native **AWS CloudFormation JSON** template, not a script that runs in GitHub. It is checked by `cfn-lint` plus independent Python assertions in GitHub Actions. It offers:
- `eu-central-1` as the intended region **to select manually** in the AWS console (a CloudFormation template does not choose an account region);
- a reviewed existing VPC and public subnet, with **no ingress rules at all**, an IPv4-only HTTPS (TCP 443) egress rule, and no NAT Gateway, load balancer, public API listener or inbound port 22;
- Amazon Linux 2023 x86_64 via the AWS public SSM AMI parameter (review the resolved AMI ID before deployment);
- `t3.small` default (2 GiB) or `t3.micro` (1 GiB), both requiring **live Free Tier / credit applicability checks**;
- SSM Session Manager IAM role with **only** `AmazonSSMManagedInstanceCore`, no SSH key in instance metadata, and IMDSv2 required;
- 20 GiB encrypted gp3 root EBS, deleted on termination (unless snapshots/extra EBS are manually created);
- `CPUCredits: standard` for predictable non-unlimited T3 credit accounting (low-credit throttling possible);
- one EIP, assigned only to this instance, to establish a stable IPv4 for a future official Supercell key allowlist;
- **every resource conditional** on `OwnerApprovedForCredits=YES`; the parameter defaults to `NO`. CloudFormation still requires account credentials and a **human-initiated** stack deployment. No GitHub workflow has AWS deployment credentials.

**The review template intentionally does not install FastAPI, PostgreSQL, cloudflared, set up a database certificate, store keys, configure invite/HMAC secrets, or enable live lookup.** These require separate operational reviews and resources. It is not a ready-to-run consumer service. The previous localhost-only `deploy/infra/crc-private-beta.service.example` must not be activated until its environment, PostgreSQL verified TLS and private ingress are ready.

## Manual checklist BEFORE authorizing any CloudFormation stack

1. In AWS console confirm **Current Plan: Free**, current credit balance, remaining calendar days, Free Tier eligibility for the selected instance, and actual EC2+EBS+IPv4 cost in `eu-central-1`. Reject any automatic **Upgrade to Paid** prompt.
2. Activate MFA. Configure AWS Budgets / Free Tier usage alerts **before** spending credits. Alerts are not a guaranteed hard stop; monitor credits while testing. The Free Plan may end on **credit exhaustion before the reported 156-day deadline**.
3. Pick one existing VPC/public subnet with internet gateway and IPv4 route. Make sure SSM endpoints are reachable over outbound HTTPS. Select actual `VpcId` and `PublicSubnetId` during review. Neither has a default in the template.
4. Confirm there is no default/network-level policy or external rule exposing TCP 22, 80, 443 or 8000 **into** the instance; the SG in this template has no ingress. The EIP is for a stable **outbound identity**, not an HTTP endpoint.
5. Review the root AMI (Amazon Linux 2023, x86_64), SSM Agent installation and SSM IAM permissions; lock down operators who can start SSM sessions and CloudFormation stacks. `CAPABILITY_IAM` is required because the template creates an IAM role/profile.
6. Review the **full estimate** for the instance, one IPv4 address, EBS, snapshots/backup, data transfer, CPU credits and alerts. The earlier USD 23.17/month was an **illustrative subtotal**, not a verified final AWS bill.
7. Set the private data export and incident plan **before** launching. Free Plan can expire earlier if credits run out; plan cutoff ~12 April 2027 is only a calendar fallback, not a guarantee of remaining credit.
8. Obtain a separate, explicit owner instruction authorizing credit consumption and maximum acceptable spending. Then perform an approved change-set review, select `OwnerApprovedForCredits=YES`, review resource list/costs and the IAM capability. Do not execute an unreviewed change set.

**No launch command is included or executed**, so this file does not act as approval to spend.

## After any future approved launch — acceptance gates

1. Verify exactly one EC2 and one associated EIP, no idle extra IPv4; confirm actual egress IPv4 by a trusted HTTPS service **before** allowlisting in the Supercell portal.
2. Check SSM Session Manager access **without** opening SSH or changing the SG; ensure instance uses IMDSv2.
3. Install the signed/backend build from immutable commit, with runtime user `crc-beta` (not root), systemd binding `127.0.0.1:8000`, and secrets only in `/etc/crc-beta/app.env` with root-only permissions. Do not place credentials in UserData, public S3 or GitHub.
4. Configure private PostgreSQL with verified TLS (`sslmode=verify-full`), least privilege, quota migration, retention cleanup job, backups and a memory budget appropriate to 2 GiB. This is not accomplished by creating EC2.
5. Establish outbound-only `cloudflared`, the existing pinned Workers VPC Service and the separate invite-code beta Worker. No direct public ingress. The Worker signs short-lived HMAC assertions and Python independently verifies them.
6. Keep `CRC_BETA_LIVE_LOOKUP_ENABLED=false` and Worker `BETA_ENABLED=false` until real protected smoke and rollback drills pass; then obtain another authorization for live lookup. Public sample Stage never inherits any beta binding.
7. Verify budget alerts and owner access to monitoring; export data well before Free Plan expiration.

## MVP without buying a domain

The private beta Worker is already deployed at crc-private-beta-gateway.alirezaanari117.workers.dev with previews disabled. It has 14 static assets, BETA_ENABLED=false, BETA_AI_CHAT_ENABLED=false and a PRIVATE_API binding to VPC Service crc-private-beta-api. The service targets 127.0.0.1:8000 through the crc-aws-private Tunnel.

Cloudflare currently reports the Tunnel down with zero active connections. The prior cloudflared container used a Docker bridge network, which cannot reach the host's loopback address. The connector must be recreated with host networking or another reviewed route before the VPC Service can reach the host.

The no-card authentication path uses invite-code hashes, an HttpOnly session cookie and a short-lived HMAC assertion. Cloudflare Access/Zero Trust is not part of this design. The public sample Worker remains separate and must never be used as the beta hostname.

The local-only FastAPI service currently owns 127.0.0.1:8000. The dedicated crc-private-beta.service was not installed at the last readiness check. Do not enable the Worker until the beta service replaces the local service on that port, the tunnel is connected and the backend secrets are injected.

## How to stop, recover, and pay nothing extra

- Before activation, `OwnerApprovedForCredits=NO` results in no template resources. CloudFormation and AWS Billing need independent operator review.
- Once provisioned, disabling the Worker and backend live lookup is the fastest **traffic stop**, but **does not stop EC2/EIP/EBS charges or credit use**.
- Stopping an instance alone **may continue to charge for EBS/EIP**; a complete teardown must delete the approved stack and independently inspect attached/detached IPv4, EBS, backups, snapshots and other resources. Confirm billing dashboard after teardown. The allocated EIP should disappear if stack teardown completes; investigate retained resources on errors.
- Before account expiry, export and verify a PostgreSQL backup, nonsecret configuration references, and Git commit SHAs to a location independent of the expiring AWS account. Do not rely on a paid upgrade to recover the only copy.
- No automatic stop/cleanup scheduler is installed: nothing guarantees the 50-dollar credit lasts for 156 days.

## Automated safeguards

The GitHub backend suite checks:
- all resources have the explicit YES condition and the default is NO;
- no ingress, SSH key, plaintext EBS or user-data secrets;
- IMDSv2 required, SSM managed policy only, CPU credits standard;
- EIP can only be associated with this instance after approval;
- `cfn-lint` syntax/schema of the CloudFormation template (read-only, no AWS API or credentials).
- Existing offline Free Tier credit scenario remains non-provisioning and the documented 50-dollar estimate is not treated as verified account data.

## Official references

- EC2 template schema: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html
- Instance MetadataOptions: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-metadataoptions.html
- Session Manager: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
- IPv4 pricing: https://aws.amazon.com/vpc/pricing/
- Workers Access: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Workers `workers.dev` hosting: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
