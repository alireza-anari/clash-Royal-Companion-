#!/usr/bin/env bash
# Run as root on EC2 after GitHub CI. --check is read-only; --stage only
# creates a locked-down tmpfs copy for the *future*, still-disabled beta.
# Never print, send to Git, Docker environment, or shell arguments any secret.
set -Eeuo pipefail
umask 077
export LC_ALL=C
set +x

readonly SOURCE_DIR=/etc/crc-beta/secrets
readonly SOURCE=/etc/crc-beta/secrets/crc-app.password
readonly BASE=/run/crc-beta
readonly RUNTIME_DIR=/run/crc-beta/creds
readonly DEST=/run/crc-beta/creds/crc-app.password
readonly RUN_UID=10001
readonly RUN_GID=10001

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || refuse 'requires sudo root'
mode="${1:---check}"
[[ $# -le 1 && ( "$mode" == --check || "$mode" == --stage ) ]] ||
  refuse 'usage: prepare-private-beta-secret.sh [--check|--stage]'
for cmd in stat install mktemp cmp ln rm docker python3; do
  command -v "$cmd" >/dev/null 2>&1 || refuse "missing prerequisite: $cmd"
done

# Do not traverse symlinks or reduce permissions on the host's root-only
# credential. Existing /etc/crc-beta may already be 0700 for secret storage.
[[ -d /etc/crc-beta && ! -L /etc/crc-beta && $(stat -c '%u' /etc/crc-beta) == 0 ]] ||
  refuse 'beta root directory untrusted'
[[ -d "$SOURCE_DIR" && ! -L "$SOURCE_DIR" &&
   "$(stat -c '%u:%a' "$SOURCE_DIR")" == 0:700 ]] ||
  refuse 'secret directory not root-only'
[[ -f "$SOURCE" && ! -L "$SOURCE" &&
   "$(stat -c '%u:%a' "$SOURCE")" == 0:600 ]] ||
  refuse 'crc_app secret is missing or not root-only'
python3 - "$SOURCE" <<'PY'
from pathlib import Path
import sys
data = Path(sys.argv[1]).read_bytes()
if not 2 <= len(data) <= 513 or not data.endswith(b'\n'):
    raise SystemExit('REFUSED: invalid stored credential format')
payload = data[:-1]
if not payload or b'\n' in payload or b'\r' in payload or b'\x00' in payload:
    raise SystemExit('REFUSED: invalid stored credential format')
try:
    payload.decode('utf-8')
except UnicodeDecodeError:
    raise SystemExit('REFUSED: invalid stored credential format')
PY

# /run must remain volatile: refuse silently persisting a less-protected
# second copy in the host root filesystem after a reboot.
[[ "$(stat -f -c %T /run)" == tmpfs ]] ||
  refuse '/run is not tmpfs; secret will not be copied to persistent storage'
active_beta="$(docker ps --format '{{.Names}}' --filter 'name=crc-private-beta' 2>/dev/null)" ||
  refuse 'Docker unavailable; beta runtime state cannot be verified'
[[ -z "$active_beta" ]] || refuse 'beta container already running'
if command -v systemctl >/dev/null 2>&1 &&
   systemctl is-active --quiet crc-private-beta.service; then
  refuse 'beta service already running'
fi
printf '%s\n' 'CRC_APP_HOST_SECRET=verified_root_only'
if [[ "$mode" == --check ]]; then
  printf '%s\n' 'CRC_APP_RUNTIME_SECRET=not_staged_by_this_check'
  printf '%s\n' 'No credentials copied, services started, database or network changed.'
  exit 0
fi

# Root-only parent traversal makes this copied credential inaccessible to
# ordinary host users. UID 10001 sees only the bind-mounted leaf file from
# inside the future nonroot container. The original stays root:root 0600.
for dir in "$BASE" "$RUNTIME_DIR"; do
  if [[ -e "$dir" || -L "$dir" ]]; then
    [[ -d "$dir" && ! -L "$dir" &&
      "$(stat -c '%u:%a' "$dir")" == 0:700 ]] ||
      refuse 'runtime secret directory untrusted'
  else
    install -d -o root -g root -m 0700 -- "$dir"
  fi
done
if [[ -e "$DEST" || -L "$DEST" ]]; then
  [[ -f "$DEST" && ! -L "$DEST" &&
      "$(stat -c '%u:%g:%a' "$DEST")" == 10001:10001:400 ]] &&
  cmp -s -- "$SOURCE" "$DEST" ||
      refuse 'existing runtime secret requires manual review'
  printf '%s\n' 'CRC_APP_RUNTIME_SECRET=already_staged_private_tmpfs'
  exit 0
fi

temp="$(mktemp "$RUNTIME_DIR/.crc-app.XXXXXXXX")"
trap 'rm -f -- "$temp"' EXIT
install -o "$RUN_UID" -g "$RUN_GID" -m 0400 -- "$SOURCE" "$temp"
cmp -s -- "$SOURCE" "$temp" ||
  refuse 'runtime credential copy differs from source'
# Hard-link within same tmpfs is exclusive and atomic; never overwrite.
ln -- "$temp" "$DEST" || refuse 'runtime credential target created concurrently'
rm -- "$temp"
trap - EXIT
[[ -f "$DEST" && ! -L "$DEST" &&
   "$(stat -c '%u:%g:%a' "$DEST")" == 10001:10001:400 &&
   "$(stat -f -c %T "$DEST")" == tmpfs ]] &&
cmp -s -- "$SOURCE" "$DEST" ||
  refuse 'staged runtime credential verification failed'
printf '%s\n' 'CRC_APP_RUNTIME_SECRET=staged_private_tmpfs'
printf '%s\n' 'No beta service, PostgreSQL change, port, Cloudflare tunnel or AI enabled.'
