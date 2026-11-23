"""Guard the read-only PostgreSQL container inventory runbook."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "inspect-private-beta-postgres.sh"


def test_postgres_inspector_is_valid_bash():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_postgres_inspector_never_dumps_secrets_or_changes_data():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "READ ONLY" in source
    assert "id -un" in source
    assert "crc-postgres" in source
    assert "docker inspect --format" in source
    assert "docker port crc-postgres 5432/tcp" in source
    assert "ss -H -ltn" in source
    assert "docker exec --user postgres" in source
    assert "psql -X -A -t -q" in source
    assert "current_setting('ssl')" in source
    assert "to_regclass('public.gateway_quota_windows')" in source
    assert "to_regclass('public.ai_daily_quota_windows')" in source
    assert ".Config.Env" not in source.split("# Explicitly inspect only metadata fields, NEVER .Config.Env")[1]
    for forbidden in (
        r"(?mi)^\s*(?:sudo\s+)?(?:docker\s+(?:run|stop|start|restart|rm|create|compose)|systemctl\s+(?:start|stop|restart|enable)|aws\s+|curl\s+)",
        r"(?mi)^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\s+\w+",
        r"\bdocker\s+inspect\s+crc-postgres\b",
        r"\bdocker\s+logs\b",
        r"\bprintenv\b",
        r"\bcat\s+/etc/\b",
    ):
        assert re.search(forbidden, source) is None, forbidden
    assert "No SQL writes, migrations" in source


def test_postgres_inventory_does_not_claim_beta_db_validation():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "maintenance database is not necessarily" in source
    assert "A Unix-socket session is NOT a TLS verification" in source
    assert "Metadata SQL: unavailable" in source
    assert "server_ssl_enabled=" in source
