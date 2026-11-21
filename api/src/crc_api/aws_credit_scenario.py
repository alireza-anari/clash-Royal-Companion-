"""Read-only $50 AWS Free Tier credit runway scenario.

No AWS SDK, network, credentials, resource creation or plan activation.
The model is an estimate, not AWS billing verification or a spend cap.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
from typing import Any


class InvalidCreditScenario(ValueError):
    pass


def validate(data: Any) -> dict[str, Any]:
    if type(data) is not dict or set(data) != {
        "schema_version", "purpose", "credit", "candidate",
        "contingency", "permissions", "observations", "resource_creation_occurred",
    }:
        raise InvalidCreditScenario("Invalid scenario schema.")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise InvalidCreditScenario("Invalid schema version.")
    if data["purpose"] != "aws-mvp-credit-planning-only":
        raise InvalidCreditScenario("This is not an AWS deployment manifest.")
    c = data["credit"]
    if type(c) is not dict or set(c) != {
        "amount_usd_reported", "verified_in_aws_billing", "account_age_months_approx",
        "plan_type", "expiry",
    } or (
        type(c["amount_usd_reported"]) is not int or c["amount_usd_reported"] != 50
        or c["verified_in_aws_billing"] is not False
        or c["account_age_months_approx"] != [1, 2]
        or c["plan_type"] != "unverified" or c["expiry"] != "unknown"
    ):
        raise InvalidCreditScenario("Unknown or misrepresented credit account data.")
    p = data["permissions"]
    if type(p) is not dict or set(p) != {
        "provisioning_allowed", "paid_plan_upgrade_allowed",
        "owner_approved_recurring_spend", "backend_live_enabled", "edge_live_enabled",
    } or any(v is not False for v in p.values()) or data["resource_creation_occurred"] is not False:
        raise InvalidCreditScenario("No AWS provisioning or live use is approved.")
    m = data["candidate"]
    expected = {
        "region": "eu-central-1", "instance_type": "t3.small", "ram_gib": 2,
        "instance_hourly_usd": 0.024, "public_ipv4_hourly_usd": 0.005,
        "storage_gib": 20, "storage_assumed_usd_per_gib_month": 0.1,
        "monthly_hours": 730,
    }
    if type(m) is not dict or set(m) != set(expected):
        raise InvalidCreditScenario("Unsupported cost model.")
    for key, val in expected.items():
        if type(m[key]) is not type(val) or m[key] != val:
            raise InvalidCreditScenario("Unsupported or changed cost assumption.")
    contingency = data["contingency"]
    if type(contingency) is not dict or set(contingency) != {
        "credit_reserve_usd", "exclude_from_estimate",
    } or type(contingency["credit_reserve_usd"]) is not int or (
        contingency["credit_reserve_usd"] != 10
    ) or contingency["exclude_from_estimate"] != [
        "taxes", "network_egress", "backup_snapshots", "extra_CPU_credits",
        "cloud_monitoring", "plan_ineligible_usage",
    ]:
        raise InvalidCreditScenario("Invalid contingency assumption.")
    sources = data["observations"]
    if type(sources) is not dict or sources != {
        "compute_rate_source": "https://cloud-credits.org/prices/ec2/t3-small/eu-central-1",
        "ipv4_rate_source": "https://aws.amazon.com/vpc/pricing/",
        "storage_rate": "conservative_assumption_not_quoted_frankfurt_rate",
        "credit_balance": "user_report_only_not_verified",
    }:
        raise InvalidCreditScenario("Unknown provenance or confidential field.")
    return data


def estimate(data: Any) -> dict[str, Any]:
    cfg = validate(data)
    m = cfg["candidate"]
    instance = Decimal(str(m["instance_hourly_usd"])) * m["monthly_hours"]
    ipv4 = Decimal(str(m["public_ipv4_hourly_usd"])) * m["monthly_hours"]
    storage = Decimal(str(m["storage_assumed_usd_per_gib_month"])) * m["storage_gib"]
    total = instance + ipv4 + storage
    credit = Decimal(cfg["credit"]["amount_usd_reported"])
    reserve = Decimal(cfg["contingency"]["credit_reserve_usd"])
    money = lambda v: float(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return {
        "provision_allowed": False,
        "account_credits_verified": False,
        "monthly_instance_estimate_usd": money(instance),
        "monthly_ipv4_estimate_usd": money(ipv4),
        "monthly_storage_assumption_usd": money(storage),
        "monthly_baseline_estimate_usd": money(total),
        "months_if_no_other_charges": money(credit / total),
        "months_with_reserved_credit": money((credit-reserve)/total),
        "estimated_total_bill_unverified": True,
        "credits_applied_to_all_charges_unverified": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline AWS credit runway scenario")
    parser.add_argument("scenario", type=Path)
    args = parser.parse_args(argv)
    try:
        report = estimate(json.loads(args.scenario.read_text(encoding="utf-8")))
    except (ValueError, OSError, TypeError):
        print(json.dumps({"ok": False, "error": "INVALID_CREDIT_SCENARIO"}))
        return 2
    print(json.dumps({"ok": True, **report}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
