"""Verified PostgreSQL TLS for the *separate* private beta runtime.

This path does not run in the local-only API and never reads private keys.
The CA is installed by an operator outside Git and mounted read-only into the
beta container. The reviewed CA fingerprint pins the expected root to prevent
an accidental swap for an attacker-controlled PEM file.

Do not use this helper as a substitute for release approval, DB authentication,
or a real client-to-database network test.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import ssl
from urllib.parse import parse_qs, urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import serialization


# Public, owner-verified certificate fingerprint (not a key or credential).
# Refresh only through an explicit CA rotation/security review.
REVIEWED_CA_SHA256 = "a274759c3a0e05262625f95af35165aa6628fdf459f14958aefa13f68be60a56"
BETA_CA_PATH = "/run/crc-beta/db-ca/ca.crt"
BETA_DB_HOST = "crc-postgres"


class BetaDatabaseTLSUnavailable(RuntimeError):
    """Sanitized, fail-closed TLS configuration error."""


def verified_beta_ssl_context(dsn: str) -> ssl.SSLContext:
    """Require exact private endpoint, verified TLS mode, and pinned CA.

    The returned SSLContext is passed as the explicit `ssl=` argument to
    asyncpg.create_pool. This prevents asyncpg defaults or host environment
    settings from silently weakening certificate/hostname verification.
    """
    try:
        parsed = urlsplit(dsn)
        options = parse_qs(parsed.query, strict_parsing=True)
        if (
            parsed.scheme not in ("postgresql", "postgres")
            or parsed.hostname != BETA_DB_HOST
            or parsed.port != 5432
            or parsed.username != "crc_app"
            or not parsed.password
            or not parsed.path.startswith("/")
            or len(parsed.path) < 2
            or parsed.fragment
            or set(options) != {"sslmode", "sslrootcert"}
            or options["sslmode"] != ["verify-full"]
            or options["sslrootcert"] != [BETA_CA_PATH]
        ):
            raise ValueError("unreviewed private beta database settings")

        path = Path(BETA_CA_PATH)
        if not path.is_file() or path.is_symlink():
            raise ValueError("CA missing or not a regular file")
        ca_pem = path.read_bytes()
        if not 100 <= len(ca_pem) <= 32768:
            raise ValueError("CA file size invalid")
        if ca_pem.count(b"-----BEGIN CERTIFICATE-----") != 1:
            raise ValueError("CA bundle must contain a single reviewed CA certificate")
        certificate = x509.load_pem_x509_certificate(ca_pem)
        if hashlib.sha256(certificate.public_bytes(serialization.Encoding.DER)).hexdigest() != REVIEWED_CA_SHA256:
            raise ValueError("CA fingerprint does not match independently reviewed value")
        if not certificate.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
            raise ValueError("CA certificate must have CA:TRUE")

        context = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH, cafile=BETA_CA_PATH)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.verify_mode = ssl.CERT_REQUIRED
        context.check_hostname = True
        return context
    except (ValueError, OSError, ssl.SSLError, x509.ExtensionNotFound) as exc:
        # Never expose full DSN, secret, OS path, or OpenSSL diagnostics.
        raise BetaDatabaseTLSUnavailable("Private beta PostgreSQL TLS trust is not configured.") from None
