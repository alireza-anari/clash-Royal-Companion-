"""AWS candidate review must stay fully offline and disabled."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from crc_api.aws_free_tier_preflight import UnsafeAWSPlan, validate, assess, main


ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "deploy" / "infra" / "aws-free-tier-plan.example.json"


@pytest.fixture
def example():
    return json.loads(PLAN.read_text(encoding="utf-8"))


def test_aws_example_is_offline_unapproved_and_has_unknown_free_tier_eligibility(example):
    result = assess(example)
    assert result["ready_to_provision"] is False
    assert result["spending_approved"] is False
    assert result["resources_created"] is False
    assert result["aws_account_eligibility_verified"] is False
    assert result["estimated_total_monthly_bill_unknown"] is True
    assert example["account"]["credits_remaining_usd"] is None
    assert example["compute"]["instance_type"] == "UNDECIDED"
    assert example["network"]["public_ipv4_hourly_list_usd"] == 0.005


@pytest.mark.parametrize(("field", "value"), [
    ("operation", "create-instance"),
    ("resources_created", True),
    ("schema_version", True),
    ("region", "us-east-1"),
])
def test_aws_billing_and_unreviewed_regions_rejected(example, field, value):
    example[field] = value
    with pytest.raises(UnsafeAWSPlan):
        validate(example)


@pytest.mark.parametrize(("container", "field", "value"), [
    ("account", "free_tier_eligibility_confirmed", True),
    ("account", "created_on", "2026-10-01"),
    ("money", "owner_authorized_recurring_spend", True),
    ("money", "no_cost_guarantee", True),
    ("network", "elastic_ip_allocated", True),
    ("network", "inbound_api_port_open", True),
    ("security", "cloudflare_edge_enabled", True),
    ("security", "backend_live_lookup_enabled", True),
    ("compute", "launched", True),
    ("compute", "instance_type", "t3.small"),
])
def test_provisioning_or_assumed_free_tier_flags_rejected(example, container, field, value):
    example[container][field] = value
    with pytest.raises(UnsafeAWSPlan):
        validate(example)


def test_unknown_fields_and_secrets_are_rejected(example):
    original = deepcopy(example)
    example["aws_secret_access_key"] = "must-not-be-in-committed-plan"
    with pytest.raises(UnsafeAWSPlan):
        validate(example)
    del example["aws_secret_access_key"]
    assert original == example


def test_offline_cli_reports_pricing_caveat_but_never_provisions(capsys):
    assert main([str(PLAN)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["ok"] is True
    assert result["approx_public_ipv4_730h_usd"] == 3.65
    assert result["estimated_total_monthly_bill_unknown"] is True
    assert result["ready_to_provision"] is False


def test_secret_bearing_aws_plan_error_never_echoes_private_values(example, tmp_path, capsys):
    example["account"]["aws_access_key"] = "AKIA-DO-NOT-COMMIT"
    candidate = tmp_path / "secret.json"
    candidate.write_text(json.dumps(example))
    assert main([str(candidate)]) == 2
    report = capsys.readouterr().out
    assert "AKIA" not in report
    assert "INVALID_AWS_EVALUATION" in report
