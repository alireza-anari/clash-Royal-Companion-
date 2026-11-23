"""Production beta TLS context is pinned, hostname-verified, and fail-closed.

All keys and certificates in these tests are generated in memory and disposable.
No AWS, provider, Docker, or production PostgreSQL connection is made.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from dataclasses import replace
import hashlib
import ssl
from pathlib import Path

import asyncpg
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
import pytest

import crc_api.beta_db_tls as tls
from crc_api.beta_gateway import BetaConfig, create_beta_app
from crc_api.supercell import SupercellClient


def _ca_fixture(tmp_path, monkeypatch, *, ca=True):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Disposable CI CA")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    pem_file = tmp_path / "ca.crt"
    pem_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    monkeypatch.setattr(tls, "BETA_CA_PATH", str(pem_file))
    monkeypatch.setattr(tls, "REVIEWED_CA_SHA256", cert.fingerprint(hashes.SHA256()).hex())
    return pem_file


def _dsn(path):
    # Password is TEST-ONLY and never printed by the production helper.
    return (
        "postgresql://crc_app:ephemeral-ci-only@crc-postgres:5432/crc_test"
        f"?sslmode=verify-full&sslrootcert={path}"
    )


def test_reviewed_ca_yields_hostname_checked_strict_ssl_context(tmp_path, monkeypatch):
    ca = _ca_fixture(tmp_path, monkeypatch)
    context = tls.verified_beta_ssl_context(_dsn(ca))
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.minimum_version >= ssl.TLSVersion.TLSv1_2
    assert len(context.get_ca_certs()) == 1


@pytest.mark.parametrize("change", [
    ("sslmode=verify-full", "sslmode=require"),
    ("sslmode=verify-full", "sslmode=verify-ca"),
    ("crc-postgres", "127.0.0.1"),
    ("crc-postgres", "unexpected-postgres"),
    ("crc_app:", "postgres:"),
    (":5432/", ":5433/"),
    ("sslrootcert=", "sslrootcert=/tmp/fake&unused="),
    ("?sslmode", "?password_hijack=123&sslmode"),
])
def test_invalid_configuration_never_downgrades_tls(tmp_path, monkeypatch, change):
    ca = _ca_fixture(tmp_path, monkeypatch)
    dsn = _dsn(ca).replace(*change)
    with pytest.raises(tls.BetaDatabaseTLSUnavailable, match="not configured"):
        tls.verified_beta_ssl_context(dsn)


def test_missing_or_changed_ca_is_rejected_without_leaking_path_or_password(tmp_path, monkeypatch):
    ca = _ca_fixture(tmp_path, monkeypatch)
    original = ca.read_bytes()
    for bad in (b"not a certificate", original + original):
        ca.write_bytes(bad)
        with pytest.raises(tls.BetaDatabaseTLSUnavailable) as error:
            tls.verified_beta_ssl_context(_dsn(ca))
        assert "ephemeral-ci-only" not in str(error.value)
        assert str(ca) not in str(error.value)
    ca.write_bytes(original)
    monkeypatch.setattr(tls, "REVIEWED_CA_SHA256", "0" * 64)
    with pytest.raises(tls.BetaDatabaseTLSUnavailable):
        tls.verified_beta_ssl_context(_dsn(ca))


def test_non_ca_certificate_rejected_even_if_fingerprint_matches(tmp_path, monkeypatch):
    ca = _ca_fixture(tmp_path, monkeypatch, ca=False)
    with pytest.raises(tls.BetaDatabaseTLSUnavailable):
        tls.verified_beta_ssl_context(_dsn(ca))


def test_real_factory_requires_pinned_ca_before_starting(monkeypatch):
    monkeypatch.setenv("CRC_BETA_RUNTIME_GATE", "private-beta-explicit-owner-approval")
    monkeypatch.setenv("CRC_BETA_HOST", "beta.example.test")
    monkeypatch.setenv("CRC_BETA_AUTH_ISSUER", "https://beta.example.test")
    monkeypatch.setenv("CRC_BETA_AUTH_AUDIENCE", "test-beta")
    monkeypatch.setenv("CRC_BETA_ALLOWED_SUBJECTS", "test-opaque-user")
    monkeypatch.setenv("CRC_BETA_POSTGRES_DSN", _dsn(tls.BETA_CA_PATH))
    monkeypatch.setenv("CRC_BETA_QUOTA_HMAC_HEX", "aa" * 32)
    monkeypatch.setenv("CRC_BETA_WORKER_ASSERTION_HMAC_HEX", "bb" * 32)
    monkeypatch.setenv("CRC_BETA_AI_ENABLED", "false")
    monkeypatch.setenv("CRC_BETA_LIVE_LOOKUP_ENABLED", "false")
    with pytest.raises(tls.BetaDatabaseTLSUnavailable):
        create_beta_app()


def test_pool_passes_strict_ssl_context_to_asyncpg(tmp_path, monkeypatch):
    ca = _ca_fixture(tmp_path, monkeypatch)
    calls = []

    class Pool:
        async def close(self):
            pass

    async def fake_create_pool(*args, **kwargs):
        calls.append((args, kwargs))
        return Pool()

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)
    config = BetaConfig(
        hostname="beta.example.test", auth_issuer="https://beta.example.test",
        audience="test-beta", allowed_subjects=frozenset({"user-1"}),
        quota_hmac_secret=b"q" * 32, worker_assertion_secret=b"w" * 32,
        database_dsn=_dsn(ca), live_lookup_enabled=False,
    )
    app = create_beta_app(config=config, supercell=SupercellClient(token=""))
    with TestClient(app, base_url="https://beta.example.test") as client:
        assert client.get("/api/v1/capabilities").status_code == 401
    assert len(calls) == 1
    assert calls[0][1]["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert calls[0][1]["ssl"].check_hostname is True
    assert calls[0][1]["dsn"] == _dsn(ca)
