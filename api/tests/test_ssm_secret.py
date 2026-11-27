"""SSM SecureString credential loader tests: no real AWS API calls."""
import json
import subprocess
from types import SimpleNamespace

import pytest

from crc_api.ssm_secret import (
    load_openrouter_key_from_ssm, SSMSecretUnavailable, PARAMETER_NAME,
    load_account_identity_key_from_ssm, AccountIdentityKeyUnavailable, ACCOUNT_ID_PARAMETER_NAME,
)


SAMPLE_KEY = "sk-or-v1-" + "a" * 48


def success_runner(calls):
    def runner(argv, **options):
        calls.append((argv, options))
        return SimpleNamespace(
            returncode=0, stderr="",
            stdout=json.dumps({
                "Parameter": {
                    "Name": PARAMETER_NAME,
                    "Type": "SecureString",
                    "Value": SAMPLE_KEY,
                }
            }),
        )
    return runner


def test_disabled_never_invokes_aws_even_if_parameter_configured():
    calls = []
    result = load_openrouter_key_from_ssm(
        enabled=False, parameter=PARAMETER_NAME,
        runner=success_runner(calls),
    )
    assert result == ""
    assert calls == []


def test_enabled_reads_only_exact_secure_parameter_without_printing_value(capsys):
    calls = []
    key = load_openrouter_key_from_ssm(
        enabled=True, parameter=PARAMETER_NAME,
        runner=success_runner(calls),
    )
    assert key == SAMPLE_KEY
    assert len(calls) == 1
    argv, options = calls[0]
    assert argv == [
        "aws", "--region", "eu-north-1", "ssm", "get-parameter",
        "--name", PARAMETER_NAME, "--with-decryption",
        "--output", "json", "--no-cli-pager",
    ]
    assert options == {
        "capture_output": True, "text": True, "timeout": 10, "check": False
    }
    assert SAMPLE_KEY not in capsys.readouterr().out


@pytest.mark.parametrize("parameter", [
    "", "/crc/mvp/other-key", "/crc/mvp/openrouter/api-key/extra",
])
def test_rejects_unauthorized_parameter_paths_before_call(parameter):
    calls = []
    with pytest.raises(SSMSecretUnavailable) as exc:
        load_openrouter_key_from_ssm(
            enabled=True, parameter=parameter,
            runner=success_runner(calls),
        )
    assert exc.value.args == ("AI_SSM_SECRET_UNAVAILABLE",)
    assert calls == []


@pytest.mark.parametrize("raw", [
    {"Parameter": {"Name": PARAMETER_NAME, "Type": "String", "Value": SAMPLE_KEY}},
    {"Parameter": {"Name": "/other", "Type": "SecureString", "Value": SAMPLE_KEY}},
    {"Parameter": {"Name": PARAMETER_NAME, "Type": "SecureString", "Value": ""}},
    {"Parameter": {"Name": PARAMETER_NAME, "Type": "SecureString", "Value": SAMPLE_KEY + "\nSECRET"}},
    {"Parameter": {"Name": PARAMETER_NAME, "Type": "SecureString", "Value": "x" * 500}},
    [],
    "garbage",
])
def test_fail_closed_for_malformed_or_non_secure_response(raw):
    def runner(argv, **options):
        return SimpleNamespace(returncode=0, stdout=json.dumps(raw), stderr="")
    with pytest.raises(SSMSecretUnavailable):
        load_openrouter_key_from_ssm(
            enabled=True, parameter=PARAMETER_NAME, runner=runner,
        )


def test_aws_failure_avoids_secret_value_in_exception_and_output(capsys):
    def failed_runner(argv, **options):
        return SimpleNamespace(
            returncode=254, stdout="",
            stderr="Denied: secret in error " + SAMPLE_KEY,
        )
    with pytest.raises(SSMSecretUnavailable) as exc:
        load_openrouter_key_from_ssm(
            enabled=True, parameter=PARAMETER_NAME, runner=failed_runner,
        )
    assert SAMPLE_KEY not in str(exc.value)
    assert SAMPLE_KEY not in capsys.readouterr().out


def test_aws_timeout_fails_closed_without_leak():
    def timed_out(argv, **options):
        raise subprocess.TimeoutExpired(argv, timeout=10, output=SAMPLE_KEY)
    with pytest.raises(SSMSecretUnavailable) as exc:
        load_openrouter_key_from_ssm(
            enabled=True, parameter=PARAMETER_NAME, runner=timed_out,
        )
    assert SAMPLE_KEY not in str(exc.value)


def test_account_id_key_loader_is_disabled_without_oidc_configuration():
    calls=[]
    assert load_account_identity_key_from_ssm(enabled=False,parameter=ACCOUNT_ID_PARAMETER_NAME,
        runner=success_runner(calls))==""
    assert calls==[]

def test_account_id_key_loader_reads_only_exact_64_hex_secure_parameter():
    value="a1"*32;calls=[]
    def runner(argv,**options):
        calls.append((argv,options))
        return SimpleNamespace(returncode=0,stderr="",stdout=json.dumps({"Parameter":{
            "Name":ACCOUNT_ID_PARAMETER_NAME,"Type":"SecureString","Value":value}}))
    assert load_account_identity_key_from_ssm(enabled=True,parameter=ACCOUNT_ID_PARAMETER_NAME,runner=runner)==value
    assert calls[0][0][calls[0][0].index("--name")+1]==ACCOUNT_ID_PARAMETER_NAME

@pytest.mark.parametrize("value",["", "x"*64, "a"*63, "a"*64+"\\nsecret"])
def test_account_id_key_loader_rejects_malformed_secret_values(value):
    def runner(argv,**options):
        return SimpleNamespace(returncode=0,stderr="",stdout=json.dumps({"Parameter":{
            "Name":ACCOUNT_ID_PARAMETER_NAME,"Type":"SecureString","Value":value}}))
    with pytest.raises(AccountIdentityKeyUnavailable):
        load_account_identity_key_from_ssm(enabled=True,parameter=ACCOUNT_ID_PARAMETER_NAME,runner=runner)

def test_account_id_key_loader_rejects_other_ssm_paths_without_aws_call():
    calls=[]
    with pytest.raises(AccountIdentityKeyUnavailable):
        load_account_identity_key_from_ssm(enabled=True,parameter=PARAMETER_NAME,runner=success_runner(calls))
    assert calls==[]
