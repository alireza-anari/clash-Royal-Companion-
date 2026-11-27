"""Redacted read-only catalog inspector for the configured PostgreSQL bootstrap role."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "inspect-private-beta-catalog.sh"


def test_catalog_inspector_is_valid_bash():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_catalog_inspector_only_uses_metadata_and_selects():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "docker inspect --format" in text
    assert "POSTGRES_USER" in text and "POSTGRES_DB" in text
    assert "env -u PGPASSWORD" in text
    assert "psql -X -A -t -q -w" in text
    assert "GATEWAY_QUOTA_TABLE_PRESENT=" in text
    assert "AI_QUOTA_TABLE_PRESENT=" in text
    assert "CRC_APP_ROLE_SUPERUSER=" in text
    assert "unexpected_or_unsafe_output" in text
    assert "TLS verify-full NOT verified" in text
    assert "No SQL writes" in text
    assert "docker logs" not in text
    assert ".Config.Env" not in text
    assert "systemctl start" not in text
    assert "docker restart" not in text
    assert "CREATE ROLE" not in text
    assert "ALTER ROLE" not in text
    assert "INSERT INTO" not in text


def _create(path: Path, name: str, code: str):
    target = path / name
    target.write_text(code, encoding="utf-8")
    target.chmod(0o755)


def _run_fake(tmp_path: Path, *, mode: str = "ok"):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _create(bin_dir, "id", "#!/bin/sh\nprintf ec2-user\n")
    _create(bin_dir, "docker", "#!/bin/sh\nexit 99\n")
    _create(bin_dir, "sudo", """#!/usr/bin/env python3
import os
import sys
args = sys.argv[1:]
if "inspect" in args:
    print("postgres:17|running|healthy")
elif "exec" in args and os.environ.get("CRC_TEST_MODE") == "bad":
    print('FATAL: database "a-secret-db-name" does not exist', file=sys.stderr)
    sys.exit(1)
elif "exec" in args:
    print("DB_ACCESSIBLE=yes")
    print("SERVER_SSL=on")
    print("CRC_APP_ROLE_PRESENT=true")
    print("CRC_APP_ROLE_LOGIN=true")
    print("CRC_APP_ROLE_SUPERUSER=false")
    print("GATEWAY_QUOTA_TABLE_PRESENT=false")
    print("AI_QUOTA_TABLE_PRESENT=false")
    if os.environ.get("CRC_TEST_MODE") == "unsafe":
        print("PASSWORD_SHOULD_NOT_LEAK=veryprivate")
else:
    sys.exit(99)
""")
    env = dict(os.environ)
    env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
    env["CRC_TEST_MODE"] = mode
    return subprocess.run(["bash", str(SCRIPT)], text=True, capture_output=True, env=env, check=False)


def test_catalog_success_emits_fixed_metadata_only(tmp_path):
    result = _run_fake(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "DB_ACCESSIBLE=yes" in result.stdout
    assert "CRC_APP_ROLE_SUPERUSER=false" in result.stdout
    assert "GATEWAY_QUOTA_TABLE_PRESENT=false" in result.stdout
    assert "CATALOG_PROBE=success" in result.stdout
    assert "SSL" in result.stdout
    assert "No SQL writes" in result.stdout


def test_catalog_unexpected_stdout_is_suppressed(tmp_path):
    result = _run_fake(tmp_path, mode="unsafe")
    assert result.returncode == 0, result.stderr
    assert "CATALOG_PROBE=unexpected_or_unsafe_output" in result.stdout
    assert "veryprivate" not in result.stdout + result.stderr
    assert "DB_ACCESSIBLE=yes" not in result.stdout


def test_catalog_auth_failure_is_redacted(tmp_path):
    result = _run_fake(tmp_path, mode="bad")
    assert result.returncode == 0, result.stderr
    assert "CATALOG_PROBE=configured_role_or_database_missing" in result.stdout
    assert "a-secret-db-name" not in result.stdout + result.stderr
