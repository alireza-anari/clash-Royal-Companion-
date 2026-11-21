"""Offline, non-destructive private-beta release and rollback checks.

This program NEVER deploys, provisions, reads a secret or enables live lookup.
Its input manifest records operator attestations, not independently verified
Cloudflare/hosting facts. Real preflight requires human and live smoke review.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any


SCHEMA_VERSION = 1
PROOFS = (
    "owner_approved",
    "spending_approved",
    "fixed_egress_ipv4_confirmed",
    "supercell_key_ip_allowlist_confirmed",
    "private_origin_isolated",
    "access_protects_all_beta_routes",
    "access_jwt_end_to_end_verified",
    "postgres_tls_verify_full_confirmed",
    "postgres_quota_migration_reviewed",
    "quota_retention_job_installed",
    "same_origin_browser_session_verified",
    "rollback_drill_passed",
    "monitoring_and_alerts_ready",
    "api_and_fan_content_terms_reviewed",
)
CONTROLS = ("edge_enabled", "backend_live_lookup_enabled")
COMMIT = re.compile(r"^[0-9a-f]{40}$")


class InvalidReleaseManifest(ValueError):
    pass


def validate(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or set(data) != {
        "schema_version", "target", "backend_commit", "frontend_commit",
        "controls", "proofs",
    }:
        raise InvalidReleaseManifest("Unexpected release manifest fields.")
    if data["schema_version"] != SCHEMA_VERSION or data["target"] != "private-beta":
        raise InvalidReleaseManifest("Unsupported beta release manifest.")
    for field in ("backend_commit", "frontend_commit"):
        value = data[field]
        if not isinstance(value, str) or (value and not COMMIT.fullmatch(value)):
            raise InvalidReleaseManifest("Release commit must be a 40-character SHA-1 or blank.")
    controls = data["controls"]
    proofs = data["proofs"]
    if not isinstance(controls, dict) or set(controls) != set(CONTROLS):
        raise InvalidReleaseManifest("Invalid release control set.")
    if not isinstance(proofs, dict) or set(proofs) != set(PROOFS):
        raise InvalidReleaseManifest("Invalid proof checklist.")
    if any(type(value) is not bool for value in controls.values()):
        raise InvalidReleaseManifest("All release switches must be booleans.")
    if any(type(value) is not bool for value in proofs.values()):
        raise InvalidReleaseManifest("All checklist values must be booleans.")
    return data


def assess(data: dict[str, Any]) -> dict[str, Any]:
    record = validate(data)
    controls = record["controls"]
    proofs = record["proofs"]
    missing = [key for key in PROOFS if not proofs[key]]
    if not record["backend_commit"]:
        missing.append("backend_commit")
    if not record["frontend_commit"]:
        missing.append("frontend_commit")
    stop_state = all(not controls[key] for key in CONTROLS)
    may_consider_release = not missing
    return {
        "status": ("disabled" if stop_state else
                   "attested_preflight_only" if may_consider_release else
                   "unsafe_activation"),
        "both_switches_disabled": stop_state,
        "missing_evidence": missing,
        "attested_preflight_complete": may_consider_release,
        # An offline manifest cannot authorize a real deployment.
        "deployment_performed": False,
        "live_environment_verified": False,
        "human_signoff_still_required": True,
    }


def rollback_plan() -> tuple[str, ...]:
    """Only printable actions; deliberately no cloud API side effects."""
    return (
        "1. Cloudflare: disable the distinct beta Worker BETA_ENABLED switch "
        "or remove its private beta route. Do NOT modify the public sample Worker.",
        "2. Backend: set CRC_BETA_LIVE_LOOKUP_ENABLED=false and restart/redeploy "
        "the private beta process. Confirm capability remains disabled.",
        "3. Access: temporarily disable invitations or the beta application "
        "if the incident involves session compromise or identity leakage.",
        "4. Verify fail-closed 503 at the beta edge, zero new Supercell "
        "upstream calls, and continued sample-only public staging.",
        "5. Preserve safe non-sensitive incident records. Do not roll back "
        "PostgreSQL schema/data automatically; migrations need review.",
        "6. Only reopen after explicit owner approval, a fresh security "
        "review, and the protected smoke-test checklist.",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline private beta release guard")
    parser.add_argument("manifest", type=Path)
    parser.add_argument(
        "--mode", choices=("lint", "require-disabled", "preflight", "rollback"),
        default="lint",
    )
    args = parser.parse_args(argv)
    try:
        data = validate(json.loads(args.manifest.read_text(encoding="utf-8")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        # No filename or raw content is copied back into output.
        print(json.dumps({"ok": False, "reason": "invalid_manifest"}))
        return 2
    report = assess(data)
    if args.mode == "rollback":
        print("\n".join(rollback_plan()))
        return 0
    if args.mode == "lint":
        print(json.dumps({"ok": True, **report}, sort_keys=True))
        return 0
    if args.mode == "require-disabled":
        ok = report["both_switches_disabled"]
    else:
        ok = report["attested_preflight_complete"]
    print(json.dumps({"ok": ok, **report}, sort_keys=True))
    return 0 if ok else 3


if __name__ == "__main__":
    raise SystemExit(main())
