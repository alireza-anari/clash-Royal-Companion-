"""Restricted AWS SSM SecureString loader for OpenRouter private beta.

Only used at private beta startup after the explicit AI opt-in switch is on.
No secret is printed, logged, stored in GitHub, or written to the instance disk.
This requires the instance IAM role to have ssm:GetParameter for the *exact*
SecureString; AWS CLI relies on the EC2 instance profile.
"""
from __future__ import annotations

import json
import re
import subprocess
from typing import Callable, Any


PARAMETER_NAME = "/crc/mvp/openrouter/api-key"
ACCOUNT_ID_PARAMETER_NAME = "/crc/mvp/account-id-hmac"
ACCOUNT_ID_KEY_PATTERN = re.compile(r"[0-9a-f]{64}", flags=re.ASCII)
AWS_REGION = "eu-north-1"
# An Authorization header value must not contain whitespace or control chars.
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]{16,256}", flags=re.ASCII)


class AccountIdentityKeyUnavailable(Exception):
    def __init__(self):
        super().__init__("ACCOUNT_ID_KEY_UNAVAILABLE")


class SSMSecretUnavailable(Exception):
    def __init__(self):
        super().__init__("AI_SSM_SECRET_UNAVAILABLE")


def load_openrouter_key_from_ssm(
    *, enabled: bool, parameter: str,
    runner: Callable[..., Any] | None = None,
) -> str:
    """Read ONLY the approved parameter; never leak a key through an exception.

    The value is held in memory by the caller, never emitted to standard output.
    Tests inject a fake subprocess runner: they never make an AWS request.
    """
    if not enabled:
        return ""
    if parameter != PARAMETER_NAME:
        raise SSMSecretUnavailable()
    run = runner if runner is not None else subprocess.run
    argv = [
        "aws", "--region", AWS_REGION, "ssm", "get-parameter",
        "--name", PARAMETER_NAME, "--with-decryption",
        "--output", "json", "--no-cli-pager",
    ]
    try:
        result = run(
            argv, capture_output=True, text=True, timeout=10, check=False,
        )
        if result.returncode != 0 or not isinstance(result.stdout, str):
            raise SSMSecretUnavailable()
        if len(result.stdout) > 4096:
            raise SSMSecretUnavailable()
        parsed = json.loads(result.stdout)
        param = parsed["Parameter"]
        if (not isinstance(param, dict) or
                param.get("Name") != PARAMETER_NAME or
                param.get("Type") != "SecureString"):
            raise SSMSecretUnavailable()
        key = param.get("Value")
        if not isinstance(key, str) or not TOKEN_PATTERN.fullmatch(key):
            raise SSMSecretUnavailable()
        return key
    except Exception:
        # The stdout, stderr and AWS CLI exception may contain sensitive text.
        # Do not interpolate, log, or chain them into application exceptions.
        raise SSMSecretUnavailable() from None


def load_account_identity_key_from_ssm(
    *, enabled: bool, parameter: str,
    runner: Callable[..., Any] | None = None,
) -> str:
    """Read the exact stable account-HMAC SecureString; never expose its value."""
    if not enabled:
        return ""
    if parameter != ACCOUNT_ID_PARAMETER_NAME:
        raise AccountIdentityKeyUnavailable()
    run = runner if runner is not None else subprocess.run
    argv = [
        "aws", "--region", AWS_REGION, "ssm", "get-parameter",
        "--name", ACCOUNT_ID_PARAMETER_NAME, "--with-decryption",
        "--output", "json", "--no-cli-pager",
    ]
    try:
        result = run(argv, capture_output=True, text=True, timeout=10, check=False)
        if result.returncode != 0 or not isinstance(result.stdout, str) or len(result.stdout) > 4096:
            raise AccountIdentityKeyUnavailable()
        parsed = json.loads(result.stdout)
        param = parsed["Parameter"]
        if (not isinstance(param, dict) or param.get("Name") != ACCOUNT_ID_PARAMETER_NAME
                or param.get("Type") != "SecureString"):
            raise AccountIdentityKeyUnavailable()
        value = param.get("Value")
        if not isinstance(value, str) or not ACCOUNT_ID_KEY_PATTERN.fullmatch(value):
            raise AccountIdentityKeyUnavailable()
        return value
    except Exception:
        raise AccountIdentityKeyUnavailable() from None
