"""Root-private CA directory must never be chmodded for ec2-user TLS probes.

Offline executable mock: emulate a public CA reachable only through sudo.
No real Docker/AWS interaction and no private certificate/key.
"""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "deploy" / "aws" / "probe-beta-client-tls.sh"


def _exe(directory: Path, name: str, contents: str) -> None:
    file = directory / name
    file.write_text(contents, encoding="utf-8")
    file.chmod(0o755)


def _run(tmp_path: Path, mode: str = "success"):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _exe(bin_dir, "id", "#!/bin/sh\nprintf 'ec2-user\\n'\n")
    _exe(bin_dir, "docker", "#!/bin/sh\nexit 97\n")
    _exe(bin_dir, "sudo", """#!/usr/bin/env python3
import os
import sys
args = sys.argv[1:]
mode = os.environ.get("CRC_MOCK_TLS_CLIENT_MODE", "")
if not args or args[0] != "-n":
    sys.exit(66)
a = args[1:]
if a[:2] == ["test", "-f"] or a[:3] == ["test", "!", "-L"] or a[:2] == ["test", "-r"]:
    sys.exit(0 if mode != "missing_ca" else 1)
if a[:2] == ["openssl", "x509"]:
    print("sha256 Fingerprint=A2:74:75:9C:3A:0E:05:26:26:25:F9:5A:F3:51:65:AA:66:28:FD:F4:59:F1:49:58:AE:FA:13:F6:8B:E6:0A:56")
elif a[:2] == ["docker", "inspect"]:
    print("postgres:17|running|healthy|crc-private")
elif a[:3] == ["docker", "network", "inspect"]:
    print("bridge|true")
elif a[:3] == ["docker", "image", "inspect"]:
    sys.exit(0)
elif a[:3] == ["docker", "port", "crc-postgres"]:
    sys.exit(1)
elif a[:2] == ["docker", "run"]:
    if a[-1] == "crc-postgres" and mode != "untrusted":
        print("CONNECTION ESTABLISHED")
        print("Protocol version: TLSv1.3")
        print("Verification: OK")
        print("INTERNAL_SERVER_CERT_PATH_MUST_NOT_LEAK", file=sys.stderr)
    else:
        print("SENSITIVE_PRIVATE_TLS_PATH_MUST_NOT_LEAK", file=sys.stderr)
        sys.exit(1)
else:
    sys.exit(66)
""")
    env = dict(os.environ)
    env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
    env["CRC_MOCK_TLS_CLIENT_MODE"] = mode
    return subprocess.run(
        ["bash", str(PROBE)],
        env=env, capture_output=True, text=True, check=False
    )


def test_root_only_ca_is_checked_via_read_only_sudo_without_chmod(tmp_path):
    # The fixed production CA path does not exist in CI. Success in this
    # scenario proves the script no longer tries to stat/read it as ec2-user.
    result = _run(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "INDEPENDENT_CLIENT_TLS=verified" in result.stdout
    assert "NEGATIVE_HOSTNAME_CHECK=denied_as_expected" in result.stdout
    assert "PRIVATE_TLS_PATH" not in result.stdout + result.stderr
    source = PROBE.read_text(encoding="utf-8")
    assert 'sudo -n test -f "$CA"' in source
    assert 'sudo -n test ! -L "$CA"' in source
    assert 'sudo -n openssl x509 -in "$CA"' in source
    assert "chmod " not in source and "chown " not in source
    assert "No live beta service" in source


def test_missing_ca_refuses_without_sensitive_output(tmp_path):
    result = _run(tmp_path, mode="missing_ca")
    assert result.returncode != 0
    assert "staged public CA missing" in result.stderr
    assert "PRIVATE_TLS_PATH" not in result.stdout + result.stderr


def test_untrusted_tls_refuses_without_sensitive_output(tmp_path):
    result = _run(tmp_path, mode="untrusted")
    assert result.returncode != 0
    assert "INDEPENDENT_CLIENT_TLS=failed" in result.stdout
    assert "SENSITIVE_PRIVATE" not in result.stdout + result.stderr
