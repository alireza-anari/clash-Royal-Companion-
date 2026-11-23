"""No-cost infrastructure contract tests. No DigitalOcean/Cloudflare calls."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from crc_api.infra_preflight import InvalidInfraPlan, inspect, main, validate


ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "deploy" / "infra" / "digitalocean-beta-plan.example.json"


@pytest.fixture
def sample():
    return json.loads(PLAN.read_text(encoding="utf-8"))


def test_committed_plan_has_no_spend_no_automation_and_no_live_service(sample):
    report = inspect(sample)
    assert report["ready_to_provision"] is False
    assert report["any_resources_created"] is False
    assert report["charges_authorized"] is False
    assert report["final_total_unknown"] is True
    assert report["baseline_only_usd_month"] == 12
    assert sample["provision_enabled"] is False
    assert sample["network"]["api_publicly_exposed"] is False
    assert sample["security"]["edge_enabled"] is False
    assert sample["security"]["backend_live_enabled"] is False


@pytest.mark.parametrize(("field", "value"), [
    ("billing_approved", True),
    ("provision_enabled", True),
    ("operation", "create"),
    ("schema_version", True),
    ("region", "nyc1"),
])
def test_any_automatic_billing_or_unreviewed_region_fails(sample, field, value):
    sample[field] = value
    with pytest.raises(InvalidInfraPlan):
        validate(sample)


@pytest.mark.parametrize(("path", "value"), [
    (("network", "api_listen_host"), "0.0.0.0"),
    (("network", "api_port"), 443),
    (("network", "api_publicly_exposed"), True),
    (("network", "cloudflare_tunnel_provisioned"), True),
    (("security", "backend_live_enabled"), True),
    (("security", "edge_enabled"), True),
    (("machine", "size_slug"), "s-4vcpu-8gb"),
    (("pricing", "billing_limit_usd_per_month"), 100),
    (("pricing", "baseline_excludes_ipv4_backup_tax_and_egress_overage"), False),
])
def test_unsafe_network_secret_release_and_cost_flags_are_rejected(sample, path, value):
    sample[path[0]][path[1]] = value
    with pytest.raises(InvalidInfraPlan):
        validate(sample)


def test_unknown_field_cannot_sneak_secrets_into_committed_plan(sample):
    original = deepcopy(sample)
    sample["api_key"] = "do-not-commit-any-credentials"
    with pytest.raises(InvalidInfraPlan):
        validate(sample)
    del sample["api_key"]
    assert sample == original


def test_cli_is_offline_and_returns_only_sanitized_plan_status(capsys, tmp_path, sample):
    assert main([str(PLAN)]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["ok"] is True
    assert output["ready_to_provision"] is False
    assert output["region"] == "fra1"
    sample["SUPERCELL_API_KEY"] = "very-private-do-not-echo"
    broken = tmp_path / "broken.json"
    broken.write_text(json.dumps(sample))
    assert main([str(broken)]) == 2
    printed = capsys.readouterr().out
    assert "very-private" not in printed
    assert "INVALID_INFRA_PLAN" in printed


def test_systemd_example_is_local_only_and_unprivileged():
    text = (ROOT / "deploy" / "infra" / "crc-private-beta.service.example").read_text()
    assert "User=crc-beta" in text
    assert "--host 127.0.0.1" in text
    assert "--port 8001" in text
    assert "--port 8000" not in text
    assert "NoNewPrivileges=true" in text
    assert "ProtectSystem=strict" in text
    assert "EnvironmentFile=/etc/crc-beta/app.env" in text
    assert "--host 0.0.0.0" not in text
    assert "SUPERCELL_API_KEY=" not in text
