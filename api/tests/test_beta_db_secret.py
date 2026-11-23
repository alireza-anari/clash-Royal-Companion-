"""Offline tests for file-based private beta database password delivery.

No production secrets, PostgreSQL, Docker daemon, or running AWS systems.
"""
import os
from pathlib import Path

import pytest

from crc_api import beta_db_secret
from crc_api.beta_gateway import BetaConfig, UnsafeBetaConfiguration
from urllib.parse import urlsplit


def _password_file(tmp_path, monkeypatch, contents=b"test@pass:/?#&%=+^" + bytes([10]), mode=0o400):
    file = tmp_path / "crc-app.password"
    file.write_bytes(contents)
    file.chmod(mode)
    monkeypatch.setattr(beta_db_secret, "RUNTIME_PASSWORD_FILE", file)
    return file


def test_password_is_url_encoded_and_strict_tls_dsn_is_derived(tmp_path, monkeypatch):
    _password_file(tmp_path, monkeypatch)
    dsn = beta_db_secret.credential_dsn("crc_beta")
    p = urlsplit(dsn)
    assert p.hostname == "crc-postgres" and p.port == 5432
    assert p.username == "crc_app"
    assert p.password == "test%40pass%3A%2F%3F%23%26%25%3D%2B%5E"
    assert p.path == "/crc_beta"
    assert p.query == "sslmode=verify-full&sslrootcert=/run/crc-beta/db-ca/ca.crt"


@pytest.mark.parametrize("contents", [
    b"", b"\n", b"password-without-newline", b"two\nlines\n",
    b"windows\r\n", b"nul\x00byte\n", b"\xff\n", b"x" * 514,
])
def test_invalid_password_format_refuses_without_leaking(tmp_path, monkeypatch, contents):
    _password_file(tmp_path, monkeypatch, contents)
    with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable) as ex:
        beta_db_secret.credential_dsn("crc_beta")
    assert "password" not in str(ex.value).lower()
    assert "crc-app.password" not in str(ex.value)


@pytest.mark.parametrize("mode", [0o600, 0o440, 0o644, 0o000])
def test_file_rejects_wrong_mode(tmp_path, monkeypatch, mode):
    _password_file(tmp_path, monkeypatch, mode=mode)
    with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable):
        beta_db_secret.credential_dsn("crc_beta")


def test_file_rejects_symlink(tmp_path, monkeypatch):
    stored = _password_file(tmp_path, monkeypatch)
    symlink = tmp_path / "symlink"
    symlink.symlink_to(stored)
    monkeypatch.setattr(beta_db_secret, "RUNTIME_PASSWORD_FILE", symlink)
    with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable):
        beta_db_secret.credential_dsn("crc_beta")


def test_file_rejects_missing_or_invalid_database(tmp_path, monkeypatch):
    _password_file(tmp_path, monkeypatch)
    for name in ("", "not valid", "../private", "postgres?sslmode=disable", "x" * 64):
        with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable):
            beta_db_secret.credential_dsn(name)
    monkeypatch.setattr(beta_db_secret, "RUNTIME_PASSWORD_FILE", tmp_path / "absent")
    with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable):
        beta_db_secret.credential_dsn("crc_beta")


def test_root_runtime_refuses_even_when_file_is_readable(tmp_path, monkeypatch):
    _password_file(tmp_path, monkeypatch)
    monkeypatch.setattr(beta_db_secret.os, "geteuid", lambda: 0)
    with pytest.raises(beta_db_secret.BetaDatabaseCredentialUnavailable):
        beta_db_secret.credential_dsn("crc_beta")


def test_env_db_password_or_dsn_not_allowed(tmp_path, monkeypatch):
    _password_file(tmp_path, monkeypatch)
    monkeypatch.setenv("CRC_BETA_RUNTIME_GATE", "private-beta-explicit-owner-approval")
    monkeypatch.setenv("CRC_BETA_POSTGRES_DB", "crc_beta")
    monkeypatch.setenv("CRC_BETA_POSTGRES_DSN", "postgresql://not-allowed:secret@server/db")
    with pytest.raises(UnsafeBetaConfiguration, match="Plaintext database"):
        BetaConfig.from_environment()


def test_review_only_deployment_is_nonroot_and_one_file_mount():
    root = Path(__file__).resolve().parents[2]
    compose = (root / "deploy/docker/compose.private-beta.review.yml").read_text()
    assert 'user: "10001:10001"' in compose
    assert "cap_drop:" in compose and "      - ALL" in compose
    assert "source: /run/crc-beta/creds/crc-app.password" in compose
    assert "target: /run/crc-beta/creds/crc-app.password" in compose
    assert "read_only: true" in compose
    assert "/etc/crc-beta/secrets/crc-app.password" not in [
        line.strip().removeprefix("source: ").strip() for line in compose.splitlines()
    ]
    assert 'profiles: ["owner-approved-private-beta-only"]' in compose


def test_root_only_tmpfs_staging_is_gated_and_never_exposes_secret():
    root = Path(__file__).resolve().parents[2]
    script = root / "deploy/aws/prepare-private-beta-secret.sh"
    assert script.is_file()
    import subprocess
    subprocess.run(["bash", "-n", str(script)], check=True)
    content = script.read_text(encoding="utf-8")
    assert "0:700" in content and "0:600" in content
    assert "10001:10001:400" in content
    assert "tmpfs" in content
    assert "cmp -s" in content and "ln --" in content
    assert "CRC_APP_HOST_SECRET=verified_root_only" in content
    assert "CRC_APP_RUNTIME_SECRET=staged_private_tmpfs" in content
    assert "docker run " not in content
    assert "docker compose up" not in content
    assert "systemctl start" not in content
    assert "ALTER ROLE" not in content
    assert "echo \"$password\"" not in content
