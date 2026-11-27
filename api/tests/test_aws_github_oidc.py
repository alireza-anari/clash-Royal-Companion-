"""Static security gates for tokenless GitHub -> AWS OIDC bootstrap.

Neither these tests nor the workflow provision AWS infrastructure.
"""
from pathlib import Path
import json
import re

import pytest

ROOT = Path(__file__).resolve().parents[2]
CF = ROOT / "deploy" / "infra" / "aws-github-oidc-readonly.bootstrap.json"
WORKFLOW = ROOT / ".github" / "workflows" / "aws-oidc-readonly.yml"
SUB = "repo:alireza-anari/clash-Royal-Companion-:ref:refs/heads/feat/backend-bootstrap"


@pytest.fixture
def infra():
    return json.loads(CF.read_text(encoding="utf-8"))


@pytest.fixture
def workflow():
    return WORKFLOW.read_text(encoding="utf-8")


def test_trust_exact_repository_branch_and_audience_no_wildcard(infra):
    role = infra["Resources"]["GitHubReadOnlyRole"]
    doc = role["Properties"]["AssumeRolePolicyDocument"]
    assert doc["Version"] == "2012-10-17"
    assert len(doc["Statement"]) == 1
    stmt = doc["Statement"][0]
    assert stmt["Effect"] == "Allow"
    assert stmt["Action"] == "sts:AssumeRoleWithWebIdentity"
    assert stmt["Condition"] == {
        "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": SUB,
        }
    }
    assert stmt["Principal"] == {"Federated": {"Fn::If": [
        "CreateNewProvider", {"Ref": "GitHubOidcProvider"},
        {"Ref": "ExistingProviderArn"},
    ]}}
    assert "*" not in json.dumps(doc)
    assert "StringLike" not in json.dumps(doc)


def test_role_is_strictly_readonly_and_limited_to_frankfurt(infra):
    role = infra["Resources"]["GitHubReadOnlyRole"]
    assert role["Type"] == "AWS::IAM::Role"
    assert role["Properties"]["MaxSessionDuration"] == 3600
    assert "RoleName" not in role["Properties"]
    assert "ManagedPolicyArns" not in role["Properties"]
    policies = role["Properties"]["Policies"]
    assert len(policies) == 1
    statements = policies[0]["PolicyDocument"]["Statement"]
    assert len(statements) == 1
    statement = statements[0]
    assert statement["Effect"] == "Allow"
    assert statement["Resource"] == "*"
    assert statement["Condition"] == {"StringEquals": {"aws:RequestedRegion": "eu-central-1"}}
    assert statement["Action"] == [
        "ec2:DescribeInstances", "ec2:DescribeVpcs", "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups", "ec2:DescribeAddresses",
        "ec2:DescribeVolumes", "ec2:DescribeRouteTables", "ec2:DescribeInternetGateways",
    ]
    assert all(a.startswith("ec2:Describe") for a in statement["Action"])


def test_can_create_provider_or_reuse_existing_and_no_duplicate_by_default(infra):
    provider = infra["Resources"]["GitHubOidcProvider"]
    assert provider["Condition"] == "CreateNewProvider"
    assert provider["Properties"]["Url"] == "https://token.actions.githubusercontent.com"
    assert provider["Properties"]["ClientIdList"] == ["sts.amazonaws.com"]
    assert "ThumbprintList" not in provider["Properties"]
    assert infra["Parameters"]["ProviderMode"]["Default"] == "CREATE"
    assert infra["Parameters"]["ProviderMode"]["AllowedValues"] == ["CREATE", "EXISTING"]
    assert infra["Conditions"]["CreateNewProvider"] == {
        "Fn::Equals": [{"Ref": "ProviderMode"}, "CREATE"]
    }
    assert "ExistingProviderRequiresArn" in infra["Rules"]
    assert "NewProviderRequiresNoArn" in infra["Rules"]
    assert infra["Outputs"]["ReadOnlyRoleArn"]["Value"] == {
        "Fn::GetAtt": ["GitHubReadOnlyRole", "Arn"]
    }


def test_oidc_stack_has_no_ec2_costs_and_no_credentials(infra):
    assert set(infra["Resources"]) == {"GitHubOidcProvider", "GitHubReadOnlyRole"}
    assert all(value["Type"].startswith("AWS::IAM::") for value in infra["Resources"].values())
    serialized = json.dumps(infra)
    assert not re.search(r"(AKIA|ASIA)[A-Z0-9]{16}", serialized)
    for sensitive in [
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "SUPERCELL_API_KEY",
        "AWS::EC2::Instance", "AWS::EC2::EIP", "AWS::S3::Bucket", "AWS::RDS::DBInstance",
        "Action\": \"*\"", "\"Principal\": \"*\"",
    ]:
        assert sensitive not in serialized


def test_workflow_fails_closed_until_variable_and_specific_branch(workflow):
    assert "branches: [feat/backend-bootstrap]" in workflow
    assert "github.repository == 'alireza-anari/clash-Royal-Companion-'" in workflow
    assert "github.ref == 'refs/heads/feat/backend-bootstrap'" in workflow
    assert "vars.AWS_CRC_OIDC_ROLE_ARN != ''" in workflow
    assert "id-token: write" in workflow
    assert "contents: read" in workflow
    assert "aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502" in workflow
    assert "role-duration-seconds: 900" in workflow
    assert "mask-aws-account-id: true" in workflow
    assert "aws-region: eu-central-1" in workflow
    assert "role-to-assume: ${{ vars.AWS_CRC_OIDC_ROLE_ARN }}" in workflow


def test_workflow_never_modifies_or_prints_private_aws_resources(workflow):
    assert "aws ec2 describe-vpcs" in workflow
    assert "aws ec2 describe-instances" in workflow
    assert "aws ec2 describe-addresses" in workflow
    assert "aws sts get-caller-identity" in workflow
    assert "--output json >" in workflow
    assert "aws ec2 run-instances" not in workflow
    assert "aws cloudformation deploy" not in workflow
    assert "aws ec2 allocate-address" not in workflow
    assert "aws iam create" not in workflow
    assert "aws s3 cp" not in workflow
    assert "AWS_SECRET_ACCESS_KEY" not in workflow
    assert "secrets.AWS_ACCESS_KEY_ID" not in workflow
    assert "secrets.AWS_SECRET_ACCESS_KEY" not in workflow
    assert "print(identity)" not in workflow
    assert "aws sts get-caller-identity --output json >" in workflow


def test_project_ci_validates_readonly_iam_template():
    yml = (ROOT / ".github" / "workflows" / "backend-tests.yml").read_text()
    assert "cfn-lint deploy/infra/aws-github-oidc-readonly.bootstrap.json" in yml
