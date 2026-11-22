"""Read-only EC2 private beta path probe safety checks."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "deploy/aws/check-private-beta-path.sh"


def test_private_beta_path_probe_is_valid_bash():
    assert PROBE.is_file()
    subprocess.run(["bash", "-n", str(PROBE)], check=True)


def test_private_beta_path_probe_does_not_modify_cloud_or_services():
    source = PROBE.read_text(encoding="utf-8")
    assert "READ-ONLY DIAGNOSTIC" in source
    assert "crc-private-beta.service" in source
    assert "crc-local-api.service" in source
    assert "cloudflared.service" in source
    assert "docker inspect --format '{{.HostConfig.NetworkMode}}'" in source
    assert "ss -H -ltn" in source
    # Restrict invocations, not mentions in comments.
    for unsafe in (
        r"\bsystemctl\s+(?:start|stop|restart|enable|disable)\b",
        r"\bdocker\s+(?:run|stop|restart|rm|exec|network\s+create)\b",
        r"\baws\s+(?:ssm|ec2|iam|secretsmanager)\b",
        r"\bcurl\b",
        r"\b(?:printenv|set -x|env\s+|cat\s+/etc/)\b",
    ):
        assert re.search(unsafe, source) is None, unsafe
    assert "BETA_ENABLED=true" not in source
    assert "CRC_BETA_RUNTIME_GATE=" not in source
    assert "GIT_TOKEN" not in source
