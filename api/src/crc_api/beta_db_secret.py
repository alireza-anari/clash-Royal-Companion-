"""Read the private beta DB password from a single, read-only runtime file.

Production source is a root-owned host secret. A guarded host-side staging
script creates a transient, UID-10001-only copy under /run (tmpfs) for a
non-root Docker process and bind-mounts ONLY that file read-only.

Never accept credentials from environment variables, Git, URLs or stdout.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import stat
from urllib.parse import quote


RUNTIME_PASSWORD_FILE = Path("/run/crc-beta/creds/crc-app.password")
DATABASE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")


class BetaDatabaseCredentialUnavailable(RuntimeError):
    """Sanitized failure: never contains a password or an absolute path."""


def credential_dsn(database: str) -> str:
    """Build a strict private DSN in process memory, not in Docker Config.Env."""
    try:
        if not DATABASE_NAME.fullmatch(database):
            raise ValueError("invalid database")
        # Prevent a uid=0 beta runtime or foreign-owned secret from being
        # mistaken for the reviewed UID 10001 deployment.
        if os.geteuid() == 0:
            raise ValueError("root container is disallowed")
        path = RUNTIME_PASSWORD_FILE
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():
            raise ValueError("untrusted mounted credential")
        if stat.S_IMODE(info.st_mode) != 0o400:
            raise ValueError("credential mode must be 0400")
        with path.open("rb") as handle:
            raw = handle.read(514)
        # A single newline is added by the operator's secure storage script.
        if not 2 <= len(raw) <= 513 or not raw.endswith(b"\n"):
            raise ValueError("invalid credential format")
        raw = raw[:-1]
        if not raw or b"\n" in raw or b"\r" in raw or b"\x00" in raw:
            raise ValueError("invalid credential bytes")
        password = raw.decode("utf-8", "strict")
        return (
            "postgresql://crc_app:"
            + quote(password, safe="")
            + "@crc-postgres:5432/"
            + database
            + "?sslmode=verify-full&sslrootcert=/run/crc-beta/db-ca/ca.crt"
        )
    except (OSError, ValueError, UnicodeError):
        raise BetaDatabaseCredentialUnavailable(
            "Private beta database credential is unavailable."
        ) from None
