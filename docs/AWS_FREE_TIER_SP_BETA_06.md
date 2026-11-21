# SP-BETA-06 — AWS Free Tier alternative for Clash Royale Companion

**Status: research + non-deploying configuration only (21 November 2026).** The product owner has access to an AWS Free Tier account. We have **not** connected to AWS credentials/account inventory, checked actual balances, or launched any EC2/EIP, EBS, RDS, Cloudflare or paid resources. The connected DigitalOcean account was checked earlier; it had 0 Droplets, but DigitalOcean is no longer the primary candidate.

## What depends on the AWS account's opening date

| AWS account history | Potential EC2 eligibility | Caution |
|---|---|---|
| Created **before 15 July 2025** | Legacy 12-month trial (typically `t2.micro`, or `t3.micro` where `t2.micro` unavailable, subject to region and other conditions) | As of November 2026 the 12-month period has ended for any account created before July 2025; do not assume compute is still free |
| Created **on/after 15 July 2025** | Credit-based Free Plan for 6 months **or until credits are depleted**, whichever is sooner; eligible EC2 instance types include `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, among others | Up to US$200 in earned credits does not mean this particular account has that balance or is still within the period |
| Free Tier status unknown | No Free Tier-based provisioning decision | Confirm current account billing mode, creation date, benefits, credits, expiration and instance eligibility first |

Sources: [AWS Free Tier](https://aws.amazon.com/free/), [EC2 Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html), [new AWS Free Plan](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/), [Free Tier terms](https://aws.amazon.com/free/terms/).

## Candidate architecture (NOT deployed)

```text
Cloudflare-hosted public sample-only website (unchanged)
               [separate beta hostname, not created]
    Cloudflare Access -> protected Worker -> VPC Service/Tunnel
                                       |
                                TLS / private origin
                                       |
AWS EC2 in eu-central-1 (Frankfurt), no public inbound API port
  - cloudflared connector outbound only
  - FastAPI private beta gateway -> 127.0.0.1:8000
  - PostgreSQL with TLS verify-full and access-limited credentials
  - systemd runs non-root, with both live switches OFF
  - Elastic IP / stable public IPv4 for **outbound Supercell allowlist**
                                       |
                            Official Supercell API
```

A public IP for outbound is **not** permission for inbound HTTP. Use AWS Security Groups to deny unsolicited inbound and a reviewed session-management method (for example SSM Session Manager), not an open SSH port. Avoid NAT Gateway for this tiny pilot because it adds separate hourly/data costs; verify actual networking choices and their terms. Review TLS certificate hostname configuration for PostgreSQL if colocated.

### Compute selection is intentionally pending

- `t3.micro` can appear in both legacy and new eligibility lists, but **1 GiB RAM may be insufficient for FastAPI + PostgreSQL + cloudflared + monitoring**.
- `t3.small` has 2 GiB RAM and is a better resource candidate for a low-concurrency beta. It is listed under the newer credit-based Free Tier, **not automatically under the legacy 12-month trial**.
- Price, CPU credit mode, EBS volumes, backup snapshots, monitoring, transfer and region must be checked in the *actual AWS Billing and EC2 console* before provisioning.
- A more robust database might require separate hosting or higher memory, so **no no-cost claim is possible yet**.

### IPv4 is not necessarily free

AWS lists public IPv4 addresses at **US$0.005 per IP-hour**, including Elastic IPs, equal to approximately **US$3.65 for 730 hours**, before any applicable account credits or allowances. An unattached Elastic IP can also incur charges; stopping an EC2 instance does not guarantee all associated resources stop billing. Always release unwanted IPv4/EBS/snapshots when retiring the pilot.

A persistent Elastic IP can preserve the Supercell allowlisted address across replacement of an instance if it remains owned and correctly reassociated. Ordinary automatically-assigned public EC2 IPv4 may change after stop/start and therefore is not a reliable permanent identity for a Supercell API key. Verify live outbound IP before adding it to the Supercell developer portal.

Source: [AWS Public IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [EC2 address usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html).

## Safeguards BEFORE considering creation

1. Confirm AWS account plan (**Free** versus **Paid**), opening date, remaining Free Tier duration, credits balance/expiry, billing region and any restrictions. Do not paste access keys or account numbers into chat/repository.
2. Enable MFA and least-privilege IAM; inspect AWS Budgets/cost alerts. A budget **alert is not a hard spending cap** on a Paid plan.
3. Check the cost of `t3.micro` and `t3.small` specifically in **eu-central-1**, public IPv4/EIP, EBS root volume, snapshots, egress traffic and any required database product.
4. Confirm that the AWS account can use the chosen eligible instance and that the projected workload fits its memory/CPU. Do not select 2 GiB solely because eligibility lists show it.
5. Prepare approved operator access via SSM or restricted SSH, outbound tunnel, inbound security group with **no public port 8000**, and a pinned Cloudflare Access/VPC Service.
6. Prepare `CRC_BETA_LIVE_LOOKUP_ENABLED=false`, `BETA_ENABLED=false` and the independent no-spend release manifest. Confirm the existing public Cloudflare Stage is unchanged.
7. Obtain explicit owner approval for **maximum recurring spend**, billing model and what happens after Free Tier/credits expire, **before any AWS resource creation**.
8. After owner approval only: launch a pinned image and size, verify fixed egress IPv4 and real Supercell key allowlist, private PostgreSQL TLS, quotas, retention cleanup, protected smoke, rollback drills and monitoring.

## Committed non-deploying artifacts

- `deploy/infra/aws-free-tier-plan.example.json`: deliberate **unknown** account eligibility/credits/instance, no keys, no resources, owner approval false. Also records the nominal US$0.005 IPv4 list rate.
- `api/src/crc_api/aws_free_tier_preflight.py`: strict, **offline** checker; no boto3, AWS CLI, SSH, account access, network, purchasing or deployment modes. It intentionally accepts only the committed all-disabled plan.
- `api/tests/test_aws_free_tier_preflight.py`: rejects enabling spending, instance launch, Elastic IP, access/lookup flags, unreviewed regions, secret fields or invented Free Tier eligibility.
- `.github/workflows/backend-tests.yml`: runs the checker in CI. The older DigitalOcean plan remains as a documented fallback, not as authorization to provision.

No infrastructure provisioning command is provided here. The next operational decision depends on verified AWS Free Tier status and explicit cost approval.

## Sources

- https://aws.amazon.com/free/
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html
- https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- https://aws.amazon.com/vpc/pricing/
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html
