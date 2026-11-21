"""No-cost, no-network AWS Free Tier host-plan reviewer for SP-BETA-06.

This is NOT a deployment tool. It cannot access AWS, create IAM roles,
read credential material, purchase IPv4, or approve billing.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class UnsafeAWSPlan(ValueError):
    pass


ACCOUNT = {"aws_account_connected_to_chat": False, "created_on": "unknown",
           "free_tier_model": "unverified", "credits_remaining_usd": None,
           "free_plan_end_date": None, "billing_mode": "unverified",
           "free_tier_eligibility_confirmed": False}
COMPUTE = {"service": "EC2", "instance_type": "UNDECIDED",
           "candidate_types": ["t3.micro", "t3.small"],
           "t3_small_requires_new_plan_eligibility_check": True,
           "recommended_min_memory_gib_for_api_and_postgres": 2,
           "ami": "UNDECIDED", "architecture": "UNDECIDED",
           "launched": False, "allocated_ebs_gib": None}
NETWORK = {"fixed_outbound_ipv4_required_for_supercell": True,
           "elastic_ip_allocated": False,
           "elastic_ip_can_incur_hourly_charges": True,
           "public_ipv4_hourly_list_usd": 0.005,
           "public_ipv4_estimated_730h_usd": 3.65,
           "security_group_ingress_approved": False,
           "inbound_api_port_open": False,
           "cloudflare_tunnel_ready": False,
           "worker_vpc_service_ready": False,
           "fixed_ipv4_allowlisted_in_supercell": False}
SECURITY = {"iam_least_privilege_confirmed": False,
            "aws_budget_alerts_configured": False,
            "budget_alert_is_not_hard_spending_cap": True,
            "ec2_instance_profile_for_ssm_reviewed": False,
            "credentials_and_key_management_reviewed": False,
            "postgres_tls_verify_full_ready": False,
            "postgres_quota_cleanup_ready": False,
            "access_policy_ready": False,
            "backend_live_lookup_enabled": False,
            "cloudflare_edge_enabled": False}
MONEY = {"owner_authorized_recurring_spend": False,
         "spending_cap_approved_usd": None, "instance_cost_verified": False,
         "storage_cost_verified": False, "public_ipv4_credit_coverage_verified": False,
         "total_monthly_cost_verified": False, "no_cost_guarantee": False}
LINKS = {
    "aws_free_tier": "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html",
    "ec2_free_tier": "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html",
    "public_ipv4_pricing": "https://aws.amazon.com/vpc/pricing/",
    "runbook": "docs/PRIVATE_BETA_DEPLOYMENT_SP_BETA_05.md",
}
EXPECTED = {
    "schema_version": 1,
    "purpose": "crc-private-beta-aws-free-tier-review",
    "operation": "read-only-plan",
    "account": ACCOUNT,
    "region": "eu-central-1",
    "compute": COMPUTE,
    "network": NETWORK,
    "security": SECURITY,
    "money": MONEY,
    "resources_created": False,
    "links": LINKS,
}


def validate(plan: Any) -> dict[str, Any]:
    # Deliberately exact, not permissive. Any "approved", "enabled",
    # account details, URLs or injected token fields must fail CI instead
    # of silently changing the committed no-spend example.
    if type(plan) is not dict or plan != EXPECTED:
        raise UnsafeAWSPlan("Unknown or potentially billable infrastructure settings.")
    return plan


def assess(plan: Any) -> dict[str, Any]:
    validate(plan)
    return {
        "ready_to_provision": False,
        "resources_created": False,
        "spending_approved": False,
        "aws_account_eligibility_verified": False,
        "known_list_public_ipv4_usd_per_hour": 0.005,
        "approx_public_ipv4_730h_usd": 3.65,
        "remaining_free_tier_credits_unknown": True,
        "estimated_total_monthly_bill_unknown": True,
        "candidate_region": "eu-central-1",
        "candidate_instance_types": ["t3.micro", "t3.small"],
        "critical_next_checks": [
            "account_opening_date_and_plan",
            "free_tier_credit_balance_and_expiration",
            "selected_ec2_free_tier_eligibility",
            "ec2_and_ebs_and_public_ipv4_pricing",
            "budget_alerts_and_owner_billing_approval",
            "private_tunnel_and_supercell_ip_allowlist",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a disabled AWS evaluation template")
    parser.add_argument("plan", type=Path)
    args = parser.parse_args(argv)
    try:
        report = assess(json.loads(args.plan.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        print(json.dumps({"ok": False, "error": "INVALID_AWS_EVALUATION"}))
        return 2
    print(json.dumps({"ok": True, **report}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
