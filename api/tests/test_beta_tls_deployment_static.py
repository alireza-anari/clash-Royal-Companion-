"""Static, offline safeguards for the review-only private beta Docker path."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = [
    ROOT / "deploy" / "aws" / "stage-public-beta-ca.sh",
    ROOT / "deploy" / "aws" / "probe-beta-client-tls.sh",
    ROOT / "deploy" / "docker" / "ci-test-private-beta-tls.sh",
]


def test_beta_tls_scripts_have_valid_bash_syntax():
    for script in SCRIPTS:
        assert script.is_file()
        subprocess.run(["bash", "-n", str(script)], check=True)


def test_public_ca_staging_is_pinned_and_never_touches_secrets():
    src = SCRIPTS[0].read_text(encoding="utf-8")
    assert "a274759c3a0e05262625f95af35165aa6628fdf459f14958aefa13f68be60a56" in src
    assert "/var/lib/docker/volumes/crc-postgres-data/_data/ca.crt" in src
    assert "/etc/crc-beta/trust/db-ca.crt" in src
    assert "CA:TRUE" in src
    assert "openssl verify -CAfile" in src
    assert "cmp -s" in src
    assert "install -o root -g root -m 0644" in src
    assert "PRIVATE_KEY" not in src
    assert "docker exec" not in src
    assert "systemctl" not in src
    assert "docker run" not in src
    assert "BETA_ENABLED=true" not in src


def test_private_beta_compose_is_default_off_and_host_loopback_only():
    compose = (ROOT / "deploy" / "docker" / "compose.private-beta.review.yml").read_text()
    assert 'profiles: ["owner-approved-private-beta-only"]' in compose
    assert '"127.0.0.1:8001:8001/tcp"' in compose
    assert "external: true" in compose
    assert "name: crc-private" in compose
    assert "read_only: true" in compose
    assert "no-new-privileges:true" in compose
    assert "cap_drop:" in compose and "ALL" in compose
    assert "source: /etc/crc-beta/trust/db-ca.crt" in compose
    assert "target: /run/crc-beta/db-ca/ca.crt" in compose
    assert "env_file:" in compose
    assert "CRC_BETA_RUNTIME_GATE=" not in compose
    assert "0.0.0.0:8001:8001" not in compose
    assert "5432:" not in compose
    assert "crc-postgres-data" not in compose


def test_beta_dockerfile_is_separate_and_non_root():
    docker = (ROOT / "deploy" / "docker" / "Dockerfile.beta").read_text()
    assert "USER 10001:10001" in docker
    assert "crc_api.beta_gateway:create_beta_app" in docker
    assert '"--port", "8001"' in docker
    assert "api[security]" in docker
    assert "CRC_BETA_AI_ENABLED=false" in docker
    assert "CRC_BETA_LIVE_LOOKUP_ENABLED=false" in docker
    assert "COPY api/" in docker
    assert "COPY .env" not in docker
    assert "ca.key" not in docker


def test_independent_client_safely_rejects_wrong_hostname_and_changes_nothing():
    src = SCRIPTS[1].read_text()
    assert "docker run --rm --pull never" in src
    assert "--network crc-private" in src
    assert "--read-only" in src and "--cap-drop ALL" in src
    assert "--verify_hostname" not in src
    assert "-verify_hostname" in src
    assert "-verify_return_error" in src
    assert "wrong-postgres-hostname" in src
    assert "NEGATIVE_HOSTNAME_CHECK=denied_as_expected" in src
    assert "CRC_APP_AUTH=not_tested" in src
    assert "docker network create" not in src
    assert "docker restart" not in src
    assert "PGPASSWORD" not in src


def test_tls_ci_uses_disposable_certs_network_and_real_libpq_asyncpg():
    src = SCRIPTS[2].read_text()
    assert 'docker network create --internal "$network"' in src
    assert 'trap cleanup EXIT' in src
    assert "openssl req -x509" in src
    assert "sslmode=verify-full" in src
    assert "LIBPQ_BAD_HOSTNAME=denied" in src
    assert "LIBPQ_WRONG_CA=denied" in src
    assert "BETA_ASYNCPG_VERIFY_FULL=success" in src
    assert "pg_stat_ssl" in src
    assert "ssl=tls.verified_beta_ssl_context(dsn)" in src
    assert "crc-postgres-data" not in src
    assert "BETA_ENABLED=true" not in src
    assert "aws " not in src.lower()


def test_tls_ci_job_does_not_use_live_services():
    workflow = (ROOT / ".github" / "workflows" / "backend-tests.yml").read_text()
    assert "private-beta-tls:" in workflow
    assert "Disposable private beta PostgreSQL verify-full (never EC2)" in workflow
    assert "bash deploy/docker/ci-test-private-beta-tls.sh" in workflow
    assert "contents: read" in workflow
