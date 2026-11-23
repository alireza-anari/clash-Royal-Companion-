"""Redacted, read-only TLS metadata and DB privileges inspector."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "check-private-beta-db-path.sh"


def test_inspector_valid_bash():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_inspector_has_no_live_or_secret_actions():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "docker network inspect --format" in source
    assert "docker inspect --format" in source
    assert "crc-private" in source
    assert "has_table_privilege" in source
    assert "QUOTA_SELECT" in source
    assert "QUOTA_INSERT" in source
    assert "QUOTA_UPDATE" in source
    assert "CERT_HOSTNAME_MATCH" in source
    assert "CERT_VALID_7_DAYS" in source
    assert "TLS_VERIFY_FULL=not_tested" in source
    assert "PGPASSWORD" in source
    assert "2>&1" in source
    assert "untrusted_output_suppressed" in source
    assert "No SQL writes" in source
    assert "docker run" not in source
    assert "docker restart" not in source
    assert "systemctl start" not in source
    assert ".Config.Env" not in source
    assert "pg_dump" not in source
    assert "SELECT *" not in source
    for keyword in ("CREATE ROLE", "GRANT ", "ALTER ROLE", "DROP TABLE",
                    "INSERT INTO", "UPDATE gateway", "DELETE FROM"):
        assert keyword not in source


def _executable(directory: Path, name: str, text: str):
    target = directory / name
    target.write_text(text, encoding="utf-8")
    target.chmod(0o755)


def _run(tmp_path: Path, mode: str = "normal"):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    _executable(bindir, "id", "#!/bin/sh\nprintf 'ec2-user\\n'\n")
    _executable(bindir, "docker", "#!/bin/sh\nexit 97\n")
    _executable(bindir, "sudo", """#!/usr/bin/env python3
import os
import sys
args = sys.argv[1:]
mode = os.environ.get("CRC_TEST_DB_PATH_MODE", "")
if "inspect" in args and "network" in args:
    print("bridge|true")
elif "inspect" in args:
    print("postgres:17|running|healthy|crc-private")
elif "exec" in args and "-i" in args:
    statement = sys.stdin.read()
    if "GRANT" in statement or "INSERT INTO" in statement:
        sys.exit(98)
    if mode == "sql_error":
        print('FATAL: password "LEAKED" is not allowed', file=sys.stderr)
        sys.exit(2)
    print("SCHEMA_USAGE=true")
    print("QUOTA_SELECT=true")
    print("QUOTA_INSERT=true")
    print("QUOTA_UPDATE=" + ("false" if mode == "no_update" else "true"))
    if mode == "sql_leak":
        print("DATABASE_PASSWORD_MUST_NOT_LEAK")
elif "exec" in args:
    if mode == "cert_error":
        print('SECRET_CERT_NAME_MUST_NOT_LEAK', file=sys.stderr)
        sys.exit(3)
    print("CERT_FILE=readable")
    print("CERT_HOSTNAME_MATCH=yes")
    print("CERT_VALID_7_DAYS=yes")
    if mode == "cert_leak":
        print("PRIVATE_CERT_PATH_MUST_NOT_LEAK")
else:
    sys.exit(97)
""")
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env.get("PATH", "")
    env["CRC_TEST_DB_PATH_MODE"] = mode
    return subprocess.run(["bash", str(SCRIPT)], env=env,
                          capture_output=True, text=True, check=False)


def test_inspector_checks_grants_network_and_cert(tmp_path):
    result = _run(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "DOCKER_NETWORK=internal_bridge" in result.stdout
    assert "QUOTA_SELECT=true" in result.stdout
    assert "QUOTA_INSERT=true" in result.stdout
    assert "QUOTA_UPDATE=true" in result.stdout
    assert "CERT_HOSTNAME_MATCH=yes" in result.stdout
    assert "CERT_VALID_7_DAYS=yes" in result.stdout
    assert "TLS_VERIFY_FULL=not_tested" in result.stdout


def test_inspector_distinguishes_missing_update_permission(tmp_path):
    result = _run(tmp_path, mode="no_update")
    assert result.returncode == 0, result.stderr
    assert "QUOTA_UPDATE=false" in result.stdout


def test_inspector_suppresses_sql_output_and_error_leaks(tmp_path):
    for mode in ("sql_error", "sql_leak"):
        root = tmp_path / mode
        root.mkdir()
        result = _run(root, mode)
        assert result.returncode == 0, result.stderr
        assert "DB_GRANTS=unavailable" in result.stdout if mode == "sql_error" else "DB_GRANTS=untrusted_output_suppressed" in result.stdout
        assert "LEAK" not in result.stdout + result.stderr


def test_inspector_suppresses_certificate_leaks(tmp_path):
    for mode in ("cert_error", "cert_leak"):
        root = tmp_path / mode
        root.mkdir()
        result = _run(root, mode)
        assert result.returncode == 0, result.stderr
        assert "CERT_METADATA=" in result.stdout
        assert "LEAK" not in result.stdout + result.stderr
