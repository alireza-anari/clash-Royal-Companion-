"""Read-only PostgreSQL diagnostics must report safe categories, never raw errors."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "diagnose-private-beta-postgres.sh"


def test_diagnostics_valid_bash():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_diagnostics_has_no_mutation_or_secret_dump():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "id -un" in src
    assert "docker inspect --format" in src
    assert "docker exec --user postgres" in src
    assert "pg_isready" in src
    assert "postgres -D /var/lib/postgresql/data -C ssl" in src
    assert "psql -X -A -t -q -w" in src
    assert "SELECT 1" in src
    assert 'role "postgres" does not exist' in src
    assert "No SQL writes" in src
    assert ".Config.Env" not in src
    assert "docker logs" not in src
    assert "docker restart" not in src
    assert "systemctl start" not in src
    assert "CREATE USER" not in src
    assert "CREATE ROLE" not in src
    assert 'printf "%s\\n" "$auth_output"' not in src
    assert 'printf \'%s\\n\' "$auth_output"' not in src


def _fake_bin(path: Path, name: str, content: str):
    file = path / name
    file.write_text(content, encoding="utf-8")
    file.chmod(0o755)


def _run_fake(tmp_path: Path, *, sql_ok: bool = False):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    _fake_bin(bindir, "id", "#!/bin/sh\nprintf ec2-user\n")
    _fake_bin(bindir, "docker", "#!/bin/sh\nexit 8\n")
    _fake_bin(bindir, "sudo", """#!/usr/bin/env python3
import os
import sys
args = sys.argv[1:]
if "inspect" in args:
    print("postgres:17|running|healthy")
elif "test" in args and "-S" in args:
    sys.exit(0)
elif "pg_isready" in args:
    sys.exit(0)
elif "postgres" in args and "-C" in args:
    print("off")
elif "psql" in args:
    if os.getenv("CRC_TEST_SQL_OK") == "1":
        print("1")
    else:
        print(\'psql: FATAL: role "postgres" does not exist [SHOULD-NOT-LEAK]\', file=sys.stderr)
        sys.exit(2)
else:
    sys.exit(9)
""")
    env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""))
    if sql_ok:
        env["CRC_TEST_SQL_OK"] = "1"
    else:
        env.pop("CRC_TEST_SQL_OK", None)
    return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, check=False)


def test_diagnostics_redact_raw_postgres_error(tmp_path):
    result = _run_fake(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "CONTAINER=postgres17_running_healthy" in result.stdout
    assert "UNIX_SOCKET=present" in result.stdout
    assert "POSTGRES_ACCEPTING_CONNECTIONS=yes" in result.stdout
    assert "SERVER_SSL_CONFIG=off" in result.stdout
    assert "LOCAL_POSTGRES_ROLE_LOGIN=postgres_db_role_missing" in result.stdout
    assert "SHOULD-NOT-LEAK" not in result.stdout + result.stderr


def test_diagnostics_healthy_local_socket_login(tmp_path):
    result = _run_fake(tmp_path, sql_ok=True)
    assert result.returncode == 0, result.stderr
    assert "LOCAL_POSTGRES_ROLE_LOGIN=ok" in result.stdout
