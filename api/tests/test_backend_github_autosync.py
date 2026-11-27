"""Static security regression checks for the GitHub -> private EC2 code-sync path."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]


def test_dedicated_ssm_document_is_not_general_aws_run_shell_script():
    data = json.loads((ROOT / "deploy/infra/aws-github-backend-sync.review.json").read_text())
    resources = data["Resources"]
    assert len(resources) == 2
    doc = resources["BackendSyncDocument"]["Properties"]
    assert doc["Name"] == "CRC-Sync-Private-Backend"
    assert doc["DocumentType"] == "Command"
    params = doc["Content"]["parameters"]
    assert params["CommitSha"]["allowedPattern"] == "^[0-9a-f]{40}$"
    assert params["CommitSha"]["interpolationType"] == "ENV_VAR"
    script = "\n".join(doc["Content"]["mainSteps"][0]["inputs"]["runCommand"])
    assert "SSM_CommitSha" in script
    assert "runuser -u ec2-user" in script
    assert "OPENROUTER_API_KEY" not in script
    assert "systemctl" not in script
    assert "ssm get-parameter" not in script


def test_oidc_role_scoped_to_exact_branch_region_instance_document():
    data = json.loads((ROOT / "deploy/infra/aws-github-backend-sync.review.json").read_text())
    role = data["Resources"]["GitHubBackendSyncRole"]["Properties"]
    trust = role["AssumeRolePolicyDocument"]["Statement"][0]
    assert trust["Action"] == "sts:AssumeRoleWithWebIdentity"
    assert trust["Condition"]["StringEquals"]["token.actions.githubusercontent.com:sub"] == (
        "repo:alireza-anari/clash-Royal-Companion-:ref:refs/heads/feat/backend-bootstrap"
    )
    policy = role["Policies"][0]["PolicyDocument"]["Statement"]
    send = next(x for x in policy if x["Sid"] == "OnlyFixedDocumentAndInstance")
    assert send["Action"] == ["ssm:SendCommand"]
    assert send["Condition"]["StringEquals"]["aws:RequestedRegion"] == "eu-north-1"
    resources = [x["Fn::Sub"] for x in send["Resource"]]
    assert all("AWS-RunShellScript" not in x for x in resources)
    assert any("document/CRC-Sync-Private-Backend" in x for x in resources)
    assert any("instance/i-0d4cbc63a5953cf14" in x for x in resources)


def test_backend_sync_never_starts_service_reads_secrets_or_overwrites_dirty_tree():
    script = (ROOT / "deploy/aws/sync-private-backend.sh").read_text()
    for required in [
        'ROOT="/opt/clash-royale-companion/backend"',
        'BRANCH="feat/backend-bootstrap"',
        "git status --porcelain",
        "git merge-base --is-ancestor",
        "git diff --check",
        "git merge --ff-only",
        '[[ "$TARGET" == "$EXPECTED_SHA" ]]',
    ]:
        assert required in script
    for forbidden in ["systemctl", "sudo", "docker compose", "get-parameter", "OPENROUTER_API_KEY", "psql"]:
        assert forbidden not in script


def test_automation_is_opt_in_and_does_not_use_permanent_aws_keys():
    workflow = (ROOT / ".github/workflows/backend-ec2-autosync.yml").read_text()
    assert "vars.CRC_BACKEND_AUTOSYNC == 'enabled'" in workflow
    assert "vars.AWS_CRC_BACKEND_SYNC_ROLE_ARN" in workflow
    assert "id-token: write" in workflow
    assert "feat/backend-bootstrap" in workflow
    assert "CRC-Sync-Private-Backend" in workflow
    assert "i-0d4cbc63a5953cf14" in workflow
    assert "AWS_SECRET_ACCESS_KEY" not in workflow
    assert "AWS_ACCESS_KEY_ID" not in workflow
    assert "ssm send-command" in workflow


def test_beta_documentation_has_no_trailing_blank_lines_that_block_git_sync():
    """EC2's git diff --check rejects new blank lines at EOF."""
    for document in (
        "docs/PRIVATE_BETA_DEPLOYMENT_SP_BETA_05.md",
        "docs/PRIVATE_BETA_GATEWAY_SP_BETA_02.md",
    ):
        value = (ROOT / document).read_text(encoding="utf-8")
        assert value.endswith(chr(10)) and not value.endswith(chr(10) * 2), document
