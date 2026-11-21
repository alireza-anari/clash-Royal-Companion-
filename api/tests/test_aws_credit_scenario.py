"""No-resource AWS credit planning and exact source/permission checks."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from crc_api.aws_credit_scenario import (
    InvalidCreditScenario, validate, estimate, main,
)

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "deploy" / "infra" / "aws-mvp-credit-scenario.example.json"


@pytest.fixture
def scenario():
    return json.loads(SCENARIO.read_text(encoding="utf-8"))


def test_reported_credit_is_not_mistaken_for_verified_balance(scenario):
    report = estimate(scenario)
    assert report["account_credits_verified"] is False
    assert report["provision_allowed"] is False
    assert report["monthly_instance_estimate_usd"] == 17.52
    assert report["monthly_ipv4_estimate_usd"] == 3.65
    assert report["monthly_storage_assumption_usd"] == 2.0
    assert report["monthly_baseline_estimate_usd"] == 23.17
    assert report["months_if_no_other_charges"] == 2.16
    assert report["months_with_reserved_credit"] == 1.73
    assert report["estimated_total_bill_unverified"] is True


@pytest.mark.parametrize(("container", "name", "value"), [
    ("credit", "verified_in_aws_billing", True),
    ("credit", "amount_usd_reported", 100),
    ("credit", "plan_type", "Free"),
    ("permissions", "provisioning_allowed", True),
    ("permissions", "owner_approved_recurring_spend", True),
    ("permissions", "backend_live_enabled", True),
    ("permissions", "edge_live_enabled", True),
    ("candidate", "instance_type", "m5.large"),
    ("candidate", "instance_hourly_usd", 0.0),
    ("candidate", "storage_gib", 0),
    ("contingency", "credit_reserve_usd", 0),
])
def test_no_provisioning_billing_assumptions_or_hidden_cost_changes(scenario, container, name, value):
    scenario[container][name] = value
    with pytest.raises(InvalidCreditScenario):
        validate(scenario)


def test_rejects_injected_access_keys_without_echo(scenario, capsys, tmp_path):
    original = deepcopy(scenario)
    scenario["aws_access_key_id"] = "AKIA-this-value-must-not-leak"
    with pytest.raises(InvalidCreditScenario):
        validate(scenario)
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(scenario))
    assert main([str(path)]) == 2
    assert "AKIA" not in capsys.readouterr().out
    del scenario["aws_access_key_id"]
    assert scenario == original


def test_cli_reports_estimate_without_changing_scenario_file(capsys):
    before = SCENARIO.read_bytes()
    assert main([str(SCENARIO)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is True
    assert report["monthly_baseline_estimate_usd"] == 23.17
    assert report["provision_allowed"] is False
    assert SCENARIO.read_bytes() == before
