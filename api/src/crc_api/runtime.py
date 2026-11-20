"""Fail-closed configuration for the local-only backend milestone.

This module is deliberately small and dependency-free. A separate, reviewed
production admission architecture is required before enabling a remote mode.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit


SAFE_HOSTS = ("127.0.0.1", "localhost", "[::1]", "testserver")
DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"


class UnsafeRuntimeConfiguration(RuntimeError):
    """No secrets or user-supplied values are echoed in this error."""


def checked_runtime_mode() -> str:
    mode = os.environ.get("CRC_RUNTIME_MODE", "local").strip().lower()
    if mode != "local":
        raise UnsafeRuntimeConfiguration(
            "Only local backend runtime is implemented; remote exposure is blocked."
        )
    return mode


def checked_local_cors_origins() -> list[str]:
    """Allow HTTP(S) origins ONLY on literal loopback hostnames.

    No wildcard, external host, URL credentials, URL path, query, or fragment.
    This check is NOT authorization: it only guards against config mistakes.
    """
    raw = os.environ.get("CRC_CORS_ORIGINS", DEFAULT_ORIGINS)
    result: list[str] = []
    for item in raw.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        try:
            url = urlsplit(candidate)
            allowed = (
                url.scheme in ("http", "https")
                and url.hostname in ("localhost", "127.0.0.1", "::1")
                and not url.username
                and not url.password
                and url.path in ("", "/")
                and not url.query
                and not url.fragment
                and url.port is not None
                and 1 <= url.port <= 65535
            )
        except ValueError:
            allowed = False
        if not allowed:
            raise UnsafeRuntimeConfiguration(
                "Only exact, port-specific local HTTP(S) origins are supported."
            )
        if candidate not in result:
            result.append(candidate)
    return result
