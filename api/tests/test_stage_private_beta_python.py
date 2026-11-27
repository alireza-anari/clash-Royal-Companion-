"""Safeguards for offline staging of a separate EC2 beta Python venv."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy" / "aws" / "stage-private-beta-python.sh"


def test_staging_script_has_valid_bash_syntax():
    assert SCRIPT.is_file()
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_staging_script_cannot_activate_live_services():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "set -Eeuo pipefail" in text
    assert "id -un" in text
    assert "ec2-user" in text
    assert "python3.12 -m venv" in text
    assert "git -C \"$CHECKOUT\" archive" in text
    assert "port 8001 already has a TCP listener" in text
    assert "env -u CRC_BETA_RUNTIME_GATE -u PYTHONPATH" in text
    assert "Private beta config gate: CLOSED (expected)" in text
    assert "No systemd unit installed" in text
    assert "No Cloudflare, Supercell, OpenRouter, or PostgreSQL request made." in text
    assert "git merge" not in text
    for forbidden in (
        r"(?m)^\s*(?:sudo\s+|aws\s+|curl\s+|wget\s+)",
        r"\bsystemctl\s+(?:start|stop|restart|enable|disable|daemon-reload)\b",
        r"\bdocker\s+(?:run|restart|stop|rm|exec)\b",
        r"\buvicorn\s+crc_api\b",
        r"\b(?:supabase|openrouter|supercell)\.com\b",
    ):
        assert re.search(forbidden, text) is None, forbidden
    assert "CRC_BETA_RUNTIME_GATE=private-beta-explicit-owner-approval" not in text
    assert "0.0.0.0:8001" not in text


def test_staging_script_never_uses_repository_as_install_target():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "readonly CHECKOUT=/opt/clash-royale-companion/backend-github" in text
    assert "readonly STAGE_ROOT=/home/ec2-user/crc-beta-staging" in text
    assert '"$dest/api[security]"' in text
    assert 'git -C "$CHECKOUT" status --porcelain' in text
    assert "READY_SHA" in text
    assert "rm -rf -- \"$dest\"" in text
    assert "pip install --no-cache-dir --no-compile" in text
