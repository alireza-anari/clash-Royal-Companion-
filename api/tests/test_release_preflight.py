"""Release validation is offline and must never enable a live beta."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from crc_api.release_preflight import (
    InvalidReleaseManifest,
    assess,
    main,
    rollback_plan,
    validate,
)

TEMPLATE = Path(__file__).resolve().parents[2] / "deploy" / "release" / "beta-manifest.example.json"


@pytest.fixture
def safe_manifest():
    return json.loads(TEMPLATE.read_text(encoding="utf-8"))


def test_committed_template_is_disabled_and_missing_evidence(safe_manifest):
    result = assess(safe_manifest)
    assert result["both_switches_disabled"] is True
    assert result["status"] == "disabled"
    assert result["attested_preflight_complete"] is False
    assert result["human_signoff_still_required"] is True
    assert result["deployment_performed"] is False
    assert "owner_approved" in result["missing_evidence"]
    assert "fixed_egress_ipv4_confirmed" in result["missing_evidence"]


@pytest.mark.parametrize("field", ["edge_enabled", "backend_live_lookup_enabled"])
def test_turning_on_any_switch_fails_disabled_guard(safe_manifest, field, tmp_path, capsys):
    safe_manifest["controls"][field] = True
    f = tmp_path / "manifest.json"
    f.write_text(json.dumps(safe_manifest))
    assert main([str(f), "--mode", "require-disabled"]) == 3
    result = json.loads(capsys.readouterr().out)
    assert result["ok"] is False
    assert result["status"] == "unsafe_activation"


@pytest.mark.parametrize("mutation", [
    lambda d: d.update(schema_version=3),
    lambda d: d.update(target="production"),
    lambda d: d["controls"].update(edge_enabled="false"),
    lambda d: d["proofs"].update(owner_approved=1),
    lambda d: d["proofs"].update(secret_access_token="do-not-log"),
    lambda d: d.update(api_secret="do-not-log"),
    lambda d: d.update(frontend_commit="not-a-git-sha"),
    lambda d: d["controls"].pop("backend_live_lookup_enabled"),
])
def test_malformed_or_secret_bearing_manifest_is_rejected(safe_manifest, mutation):
    mutation(safe_manifest)
    with pytest.raises(InvalidReleaseManifest):
        validate(safe_manifest)


def test_full_offline_attestation_is_not_a_deployment_or_owner_authorization(safe_manifest):
    for key in safe_manifest["proofs"]:
        safe_manifest["proofs"][key] = True
    safe_manifest["backend_commit"] = "a" * 40
    safe_manifest["frontend_commit"] = "b" * 40
    safe_manifest["controls"]["edge_enabled"] = True
    safe_manifest["controls"]["backend_live_lookup_enabled"] = True
    result = assess(safe_manifest)
    assert result["status"] == "attested_preflight_only"
    assert result["attested_preflight_complete"] is True
    assert result["deployment_performed"] is False
    assert result["live_environment_verified"] is False
    assert result["human_signoff_still_required"] is True


def test_preflight_requires_real_evidence_and_commit_identifiers(safe_manifest, tmp_path, capsys):
    safe_manifest["proofs"]["owner_approved"] = True
    file = tmp_path / "manifest.json"
    file.write_text(json.dumps(safe_manifest))
    assert main([str(file), "--mode", "preflight"]) == 3
    result = json.loads(capsys.readouterr().out)
    assert "frontend_commit" in result["missing_evidence"]
    assert "api_and_fan_content_terms_reviewed" in result["missing_evidence"]


def test_offline_lint_and_disabled_modes_pass_but_do_not_enable_anything(capsys):
    assert main([str(TEMPLATE), "--mode", "lint"]) == 0
    assert json.loads(capsys.readouterr().out)["both_switches_disabled"] is True
    assert main([str(TEMPLATE), "--mode", "require-disabled"]) == 0
    assert json.loads(capsys.readouterr().out)["deployment_performed"] is False


def test_rollback_runbook_only_prints_steps_and_never_changes_switches(safe_manifest, tmp_path, capsys):
    snapshot = deepcopy(safe_manifest)
    file = tmp_path / "manifest.json"
    file.write_text(json.dumps(safe_manifest))
    assert main([str(file), "--mode", "rollback"]) == 0
    out = capsys.readouterr().out
    assert "BETA_ENABLED" in out
    assert "CRC_BETA_LIVE_LOOKUP_ENABLED=false" in out
    assert "Do NOT modify the public sample Worker." in out
    assert safe_manifest == snapshot
    assert len(rollback_plan()) >= 5


def test_bad_manifest_file_returns_safe_error_without_reflecting_content(tmp_path, capsys):
    file = tmp_path / "secret-file.json"
    file.write_text('{"jwt": "secret-value"}')
    assert main([str(file), "--mode", "lint"]) == 2
    printed = capsys.readouterr().out
    assert "secret-value" not in printed
    assert "invalid_manifest" in printed
