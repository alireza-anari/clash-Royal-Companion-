"""Fail-closed, read-only PostgreSQL beta credential readiness script.

Script is invoked with MOCKED sudo/Docker on CI; production DB is never used.
"""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "probe-private-beta-db-auth.sh"


def _write_executable(parent: Path, name: str, body: str):
    target = parent / name
    target.write_text(body, encoding="utf-8")
    target.chmod(0o755)


def _run_check(tmp_path: Path, mode: str = "ready"):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_executable(bin_dir, "id", "#!/bin/sh\nprintf 'ec2-user\\n'\n")
    _write_executable(bin_dir, "docker", "#!/bin/sh\nexit 91\n")
    _write_executable(bin_dir, "sudo", """#!/usr/bin/env python3
import os
import sys
args = sys.argv[1:]
mode = os.environ.get("CRC_MOCK_DB_AUTH_MODE", "")
if not args or args[0] != "-n":
    sys.exit(89)
a = args[1:]
if a[:2] == ["test", "-f"] or a[:3] == ["test", "!", "-L"] or a[:2] == ["test", "-r"]:
    sys.exit(1 if mode == "missing_ca" else 0)
if a[:2] == ["openssl", "x509"]:
    print("sha256 Fingerprint=A2:74:75:9C:3A:0E:05:26:26:25:F9:5A:F3:51:65:AA:66:28:FD:F4:59:F1:49:58:AE:FA:13:F6:8B:E6:0A:56")
elif a[:2] == ["docker", "inspect"]:
    print("postgres:17|running|healthy|crc-private")
elif a[:3] == ["docker", "network", "inspect"]:
    print("bridge|true")
elif a[:3] == ["docker", "port", "crc-postgres"]:
    sys.exit(1)
elif a[:2] == ["docker", "exec"] and "-i" in a:
    statement = sys.stdin.read()
    if "UPDATE " in statement or "INSERT INTO" in statement or "ALTER ROLE" in statement:
        sys.exit(95)
    if mode == "catalog_error":
        print("SECRET_HASH_AND_DB_PASSWORD_MUST_NOT_LEAK", file=sys.stderr)
        sys.exit(3)
    print("CRC_APP_PASSWORD_CONFIGURED=false" if mode == "unset" else "CRC_APP_PASSWORD_CONFIGURED=true")
    if mode == "unsafe_response":
        print("LEAKED_REAL_DB_NAME_OR_HASH")
else:
    sys.exit(89)
""")
    env = dict(os.environ)
    env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
    env["CRC_MOCK_DB_AUTH_MODE"] = mode
    return subprocess.run(
        ["bash", str(SCRIPT), "--check"],
        env=env, capture_output=True, text=True, check=False,
    )


def test_script_has_valid_bash_syntax():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_read_only_role_password_presence_and_no_actual_password(tmp_path):
    result = _run_check(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "CRC_APP_PASSWORD_CONFIGURED=true" in result.stdout
    assert "CRC_APP_AUTH=not_tested" in result.stdout
    assert "LEAK" not in result.stdout + result.stderr


def test_password_unset_is_visible_only_as_boolean(tmp_path):
    result = _run_check(tmp_path, "unset")
    assert result.returncode == 0
    assert "CRC_APP_PASSWORD_CONFIGURED=false" in result.stdout


def test_catalog_error_and_unexpected_text_are_redacted(tmp_path):
    for mode in ("catalog_error", "unsafe_response"):
        root = tmp_path / mode
        root.mkdir()
        result = _run_check(root, mode)
        assert result.returncode == 0, result.stderr
        assert "CRC_APP_PASSWORD_CONFIGURED=unknown" in result.stdout
        assert "LEAK" not in result.stdout + result.stderr


def test_missing_public_ca_refuses_before_any_db_query(tmp_path):
    result = _run_check(tmp_path, "missing_ca")
    assert result.returncode != 0
    assert "public CA is missing" in result.stderr


def test_probe_never_writes_db_or_persists_password():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "pg_authid" in src
    assert "rolpassword IS NOT NULL" in src
    assert "verify-full" in src
    assert "default_transaction_read_only=on" in src
    assert "pg_stat_ssl" in src
    assert "CRC_APP_AUTH=verified_read_only_tls_and_grants" in src
    assert "read -r -s secret </dev/tty" in src
    assert r"""printf '%s\n' "$secret" |""" in src
    assert 'IFS= read -r PGPASSWORD' in src
    assert "docker run --rm -i --pull never" in src
    assert "stage-public-beta-ca" not in src
    assert "docker network create" not in src
    assert "docker restart" not in src
    assert "systemctl start" not in src
    assert "ALTER ROLE" not in src
    assert "UPDATE gateway_quota_windows" not in src
    assert "INSERT INTO" not in src
    assert "DELETE FROM" not in src
    assert ".Config.Env" not in src
    assert "--env PGPASSWORD" not in src
    assert "No database writes" in src
