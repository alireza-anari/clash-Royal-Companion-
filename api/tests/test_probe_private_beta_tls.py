"""Read-only PostgreSQL SSLRequest handshake probe: strict CA and redacted output."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "deploy" / "aws" / "probe-private-beta-tls.sh"


def test_tls_probe_valid_bash():
    assert PROBE.is_file()
    subprocess.run(["bash", "-n", str(PROBE)], check=True)


def test_tls_probe_is_strict_and_does_not_mutate():
    content = PROBE.read_text(encoding="utf-8")
    assert "-starttls postgres" in content
    assert "-verify_hostname crc-postgres" in content
    assert "-verify_return_error" in content
    assert "CONNECTION ESTABLISHED" in content
    assert "Verification: OK" in content
    assert "BETA_TO_DB_VERIFY_FULL=not_tested" in content
    assert "docker inspect --format" in content
    assert "TLS_DEFAULT_CA_AND_HOSTNAME=not_verified" in content
    assert "docker run" not in content
    assert "docker restart" not in content
    assert "systemctl start" not in content
    assert ".Config.Env" not in content
    assert "-CAfile" not in content
    assert " -verify 0 " not in content
    assert "openssl s_client" in content


def _create(folder: Path, name: str, contents: str):
    p = folder / name
    p.write_text(contents, encoding="utf-8")
    p.chmod(0o755)


def _probe(tmp_path: Path, mode="success"):
    directory = tmp_path / "bin"
    directory.mkdir()
    _create(directory, "id", "#!/bin/sh\nprintf 'ec2-user\\n'\n")
    _create(directory, "docker", "#!/bin/sh\nexit 1\n")
    _create(directory, "sudo", """#!/usr/bin/env python3
import os
import sys
a = sys.argv[1:]
mode = os.environ.get("CRC_TLS_TEST_MODE", "success")
if "inspect" in a:
    print("postgres:17|running|healthy|crc-private")
elif "exec" in a:
    if mode == "success":
        print("CONNECTION ESTABLISHED")
        print("Protocol version: TLSv1.3")
        print("Verification: OK")
        print('Peer certificate: SECRET_SUBJECT_SHOULD_NOT_LEAK', file=sys.stderr)
    elif mode == "untrusted":
        print('verify error: SECRET_CA_NOT_TRUSTED_SHOULD_NOT_LEAK', file=sys.stderr)
        sys.exit(1)
    elif mode == "incomplete":
        print("Protocol version: TLSv1.3")
        print("Verification: OK")
        print('INTERNAL_HOST_LEAK', file=sys.stderr)
else:
    sys.exit(1)
""")
    env = dict(os.environ)
    env["PATH"] = str(directory) + os.pathsep + env.get("PATH", "")
    env["CRC_TLS_TEST_MODE"] = mode
    return subprocess.run(["bash", str(PROBE)], env=env,
                          capture_output=True, text=True, check=False)


def test_success_requires_default_ca_and_hostname_evidence(tmp_path):
    result = _probe(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "TLS_DEFAULT_CA_AND_HOSTNAME=verified" in result.stdout
    assert "TLS_ENCRYPTED_HANDSHAKE=established" in result.stdout
    assert "BETA_TO_DB_VERIFY_FULL=not_tested" in result.stdout
    assert "SECRET" not in result.stdout + result.stderr


def test_untrusted_certificate_fails_closed_without_raw_errors(tmp_path):
    result = _probe(tmp_path, "untrusted")
    assert result.returncode == 0, result.stderr
    assert "TLS_DEFAULT_CA_AND_HOSTNAME=not_verified" in result.stdout
    assert "SECRET" not in result.stdout + result.stderr


def test_incomplete_handshake_never_claims_verified(tmp_path):
    result = _probe(tmp_path, "incomplete")
    assert result.returncode == 0, result.stderr
    assert "TLS_DEFAULT_CA_AND_HOSTNAME=not_proven" in result.stdout
    assert "TLS_DEFAULT_CA_AND_HOSTNAME=verified" not in result.stdout
    assert "INTERNAL_HOST_LEAK" not in result.stdout + result.stderr
