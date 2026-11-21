"""Read-only SP-BETA-06 infrastructure contract verifier.

This CLI deliberately has NO cloud provider SDK, API calls, shell commands or
provisioning mode. Passing it never authorizes resource creation or spending.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_ROOT = {
    "schema_version", "purpose", "operation", "billing_approved",
    "provision_enabled", "expected_existing_droplets", "region", "machine",
    "pricing", "network", "security", "references",
}
EXPECTED_MACHINE = {
    "provider", "kind", "size_slug", "vcpu", "ram_mib", "baseline_usd_per_month",
}
EXPECTED_PRICING = {
    "observed_date", "currency", "baseline_excludes_ipv4_backup_tax_and_egress_overage",
    "billing_limit_usd_per_month",
}
EXPECTED_NETWORK = {
    "public_ipv4_required_for_allowlist", "public_ipv4_egress_needs_live_verification",
    "api_listen_host", "api_port", "api_publicly_exposed",
    "ssh_source_allowlist_configured", "cloudflare_vpc_service_provisioned",
    "cloudflare_tunnel_provisioned",
}
EXPECTED_SECURITY = {
    "ssh_key_approved", "full_access_policy_ready", "database_tls_verify_full_ready",
    "backup_policy_reviewed", "quota_cleanup_scheduler_ready",
    "supercell_key_approved", "backend_live_enabled", "edge_enabled",
}
EXPECTED_REFS = {"cloudflare_worker", "backend_entrypoint", "runbook"}


class InvalidInfraPlan(ValueError):
    pass


def _exact(obj: Any, keys: set[str]) -> bool:
    return isinstance(obj, dict) and set(obj) == keys


def validate(plan: Any) -> dict[str, Any]:
    if not _exact(plan, EXPECTED_ROOT):
        raise InvalidInfraPlan("Unexpected infrastructure plan fields.")
    if not all([
        _exact(plan["machine"], EXPECTED_MACHINE),
        _exact(plan["pricing"], EXPECTED_PRICING),
        _exact(plan["network"], EXPECTED_NETWORK),
        _exact(plan["security"], EXPECTED_SECURITY),
        _exact(plan["references"], EXPECTED_REFS),
    ]):
        raise InvalidInfraPlan("Unexpected nested plan fields.")
    if (
        type(plan["schema_version"]) is not int or plan["schema_version"] != 1 or
        plan["purpose"] != "crc-private-beta-pre-provision" or
        plan["operation"] != "read-only-plan" or
        plan["billing_approved"] is not False or
        plan["provision_enabled"] is not False or
        type(plan["expected_existing_droplets"]) is not int or
        plan["expected_existing_droplets"] < 0
    ):
        raise InvalidInfraPlan("Infrastructure creation and spending are disabled.")
    if plan["region"] != "fra1":
        raise InvalidInfraPlan("Only reviewed candidate region fra1 is recorded.")
    m = plan["machine"]
    if (m["provider"], m["kind"], m["size_slug"], m["vcpu"], m["ram_mib"],
        m["baseline_usd_per_month"]) != (
        "DigitalOcean", "basic-droplet", "s-1vcpu-2gb", 1, 2048, 12
    ):
        raise InvalidInfraPlan("Unexpected machine candidate or baseline.")
    pricing = plan["pricing"]
    if (
        pricing["currency"] != "USD" or
        pricing["observed_date"] != "2026-11-21" or
        pricing["baseline_excludes_ipv4_backup_tax_and_egress_overage"] is not True or
        pricing["billing_limit_usd_per_month"] is not None
    ):
        raise InvalidInfraPlan("Pricing is indicative only, not spend authorization.")
    network = plan["network"]
    if (
        network["api_listen_host"] != "127.0.0.1" or
        type(network["api_port"]) is not int or network["api_port"] != 8000 or
        network["api_publicly_exposed"] is not False or
        network["public_ipv4_required_for_allowlist"] is not True or
        network["public_ipv4_egress_needs_live_verification"] is not True
    ):
        raise InvalidInfraPlan("Private API isolation must remain explicit.")
    required_false = {
        "ssh_source_allowlist_configured", "cloudflare_vpc_service_provisioned",
        "cloudflare_tunnel_provisioned",
    }
    if any(network[key] is not False for key in required_false):
        raise InvalidInfraPlan("Unverified network prerequisites cannot be pre-approved.")
    if not _exact(plan["security"], EXPECTED_SECURITY) or any(
        value is not False for value in plan["security"].values()
    ):
        raise InvalidInfraPlan("Do not mark unverified security gates complete.")
    if plan["references"] != {
        "cloudflare_worker": "deploy/cloudflare/beta-edge-worker.mjs",
        "backend_entrypoint": "crc_api.beta_gateway:create_beta_app",
        "runbook": "docs/PRIVATE_BETA_DEPLOYMENT_SP_BETA_05.md",
    }:
        raise InvalidInfraPlan("Infra references must match reviewed implementation.")
    return plan


def inspect(plan: dict[str, Any]) -> dict[str, Any]:
    validate(plan)
    missing = [
        "explicit_recurring_spend_approval", "private_origin_and_cloudflare_vpc_service",
        "SSH_allowlist_and_operator_key", "verified_database_tls_and_retention",
        "egress_IP_and_Supercell_allowlist", "Access_policy_end_to_end",
        "rollback_smoke_and_monitoring",
    ]
    return {
        "ready_to_provision": False,
        "any_resources_created": False,
        "charges_authorized": False,
        "baseline_only_usd_month": 12,
        "final_total_unknown": True,
        "region": "fra1",
        "size": "s-1vcpu-2gb",
        "unmet_prerequisites": missing,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline, zero-mutation infrastructure guard")
    parser.add_argument("plan", type=Path)
    args = parser.parse_args(argv)
    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
        report = inspect(plan)
    except (ValueError, OSError):
        print(json.dumps({"ok": False, "code": "INVALID_INFRA_PLAN"}))
        return 2
    print(json.dumps({"ok": True, **report}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
