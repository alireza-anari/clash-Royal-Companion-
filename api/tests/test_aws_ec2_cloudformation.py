"""Fail-closed review of AWS EC2 CloudFormation before any paid resources exist.

This test does not call AWS, allocate a public IPv4 or launch anything.
"""
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "deploy" / "infra" / "aws-ec2-private-beta.review.json"


@pytest.fixture
def template():
    return json.loads(TEMPLATE.read_text(encoding="utf-8"))


def test_approval_gate_is_explicit_and_defaults_to_no(template):
    approval = template["Parameters"]["OwnerApprovedForCredits"]
    assert approval["Default"] == "NO"
    assert approval["AllowedValues"] == ["NO", "YES"]
    assert template["Conditions"]["CreateBetaInfrastructure"] == {
        "Fn::Equals": [{"Ref": "OwnerApprovedForCredits"}, "YES"]
    }
    assert template["Resources"]
    assert all(resource.get("Condition") == "CreateBetaInfrastructure"
               for resource in template["Resources"].values())
    assert all(output.get("Condition") == "CreateBetaInfrastructure"
               for output in template["Outputs"].values())


def test_instance_is_on_free_tier_candidate_list_only_not_launched(template):
    parameters = template["Parameters"]
    assert parameters["InstanceType"]["Default"] == "t3.small"
    assert parameters["InstanceType"]["AllowedValues"] == ["t3.micro", "t3.small"]
    assert parameters["AmiId"]["Default"] == (
        "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
    )
    assert parameters["VpcId"]["Type"] == "AWS::EC2::VPC::Id"
    assert parameters["PublicSubnetId"]["Type"] == "AWS::EC2::Subnet::Id"
    assert all("Default" not in parameters[x] for x in ("VpcId", "PublicSubnetId"))


def test_instance_has_no_public_ingress_ssh_or_user_data(template):
    group = template["Resources"]["BetaSecurityGroup"]
    assert group["Type"] == "AWS::EC2::SecurityGroup"
    rules = group["Properties"]
    assert rules["SecurityGroupIngress"] == []
    assert rules["SecurityGroupEgress"] == [{
        "IpProtocol": "tcp", "FromPort": 443, "ToPort": 443,
        "CidrIp": "0.0.0.0/0",
        "Description": "SSM, Cloudflare Tunnel and HTTPS updates only",
    }]
    instance = template["Resources"]["BetaInstance"]["Properties"]
    assert "KeyName" not in instance
    assert "UserData" not in instance
    assert instance["NetworkInterfaces"][0]["AssociatePublicIpAddress"] is False
    assert instance["NetworkInterfaces"][0]["GroupSet"] == [
        {"Ref": "BetaSecurityGroup"}
    ]
    assert "SecurityGroups" not in instance
    assert "SecurityGroupIds" not in instance
    assert not any(r["Type"].endswith(("LoadBalancer", "NatGateway"))
                   for r in template["Resources"].values())


def test_imdsv2_and_encrypted_small_root_disk_only(template):
    inst = template["Resources"]["BetaInstance"]["Properties"]
    assert inst["MetadataOptions"] == {
        "HttpEndpoint": "enabled", "HttpTokens": "required",
        "HttpPutResponseHopLimit": 1, "InstanceMetadataTags": "disabled",
    }
    assert inst["Monitoring"] is False
    assert inst["CreditSpecification"] == {"CPUCredits": "standard"}
    block = inst["BlockDeviceMappings"]
    assert len(block) == 1
    assert block[0]["Ebs"] == {
        "VolumeSize": 20, "VolumeType": "gp3",
        "Encrypted": True, "DeleteOnTermination": True,
    }


def test_ssm_role_only_has_session_manager_core(template):
    role = template["Resources"]["BetaSsmRole"]
    assert role["Type"] == "AWS::IAM::Role"
    assert role["Properties"]["ManagedPolicyArns"] == [
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    ]
    assert role["Properties"]["AssumeRolePolicyDocument"]["Statement"] == [{
        "Effect": "Allow",
        "Principal": {"Service": ["ec2.amazonaws.com"]},
        "Action": ["sts:AssumeRole"],
    }]
    assert "Policies" not in role["Properties"]
    assert template["Resources"]["BetaInstance"]["Properties"]["IamInstanceProfile"] == {
        "Ref": "BetaInstanceProfile"
    }


def test_fixed_egress_ipv4_only_after_explicit_approval(template):
    resources = template["Resources"]
    assert resources["BetaElasticIp"]["Type"] == "AWS::EC2::EIP"
    assert resources["BetaElasticIp"]["Properties"]["Domain"] == "vpc"
    association = resources["BetaEipAssociation"]
    assert association["Type"] == "AWS::EC2::EIPAssociation"
    assert association["Properties"]["AllocationId"] == {
        "Fn::GetAtt": ["BetaElasticIp", "AllocationId"]
    }
    assert association["Properties"]["InstanceId"] == {"Ref": "BetaInstance"}


def test_no_credentials_domains_or_live_feature_flags_in_infra(template):
    txt = json.dumps(template)
    for forbidden in (
        "SUPERCELL_API_KEY=", "CRC_BETA_LIVE_LOOKUP_ENABLED=true",
        "BETA_ENABLED=true", "CF_Authorization=", "postgresql://",
        "cloudflared tunnel run", "aws ec2 run-instances",
    ):
        assert forbidden not in txt
    assert "AWS::RDS::DBInstance" not in txt
    assert "AWS::EC2::NatGateway" not in txt
    assert "AWS::ElasticLoadBalancingV2::LoadBalancer" not in txt
