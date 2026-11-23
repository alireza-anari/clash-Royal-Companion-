#!/usr/bin/env bash
# Copy ONLY an operator-verified public CA certificate to the beta trust path.
# No Docker, PostgreSQL, cloud, API, systemd or firewall changes.
set -Eeuo pipefail
umask 077
export LC_ALL=C

readonly SOURCE=/var/lib/docker/volumes/crc-postgres-data/_data/ca.crt
readonly BASE=/etc/crc-beta
readonly DEST_DIR=/etc/crc-beta/trust
readonly TARGET=/etc/crc-beta/trust/db-ca.crt
readonly REVIEWED_FINGERPRINT=a274759c3a0e05262625f95af35165aa6628fdf459f14958aefa13f68be60a56

refuse() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || refuse 'run as root via sudo'
for cmd in openssl install mktemp mv stat grep tr sed cmp; do
  command -v "$cmd" >/dev/null 2>&1 || refuse "missing command: $cmd"
done
[[ -f "$SOURCE" && ! -L "$SOURCE" && -r "$SOURCE" ]] || refuse 'reviewed CA source unavailable'
fingerprint="$(openssl x509 -in "$SOURCE" -noout -fingerprint -sha256 2>/dev/null |
  sed -n 's/^sha256 Fingerprint=//p' | tr -d ':' | tr 'A-F' 'a-f')"
[[ "$fingerprint" == "$REVIEWED_FINGERPRINT" ]] || refuse 'CA certificate fingerprint differs from owner-reviewed value'
constraints="$(openssl x509 -in "$SOURCE" -noout -ext basicConstraints 2>/dev/null)"
grep -Fq 'CA:TRUE' <<< "$constraints" || refuse 'not a CA certificate'
openssl x509 -in "$SOURCE" -noout -checkend 604800 >/dev/null 2>&1 ||
  refuse 'CA expires within 7 days or is invalid'
openssl verify -CAfile "$SOURCE" "$SOURCE" >/dev/null 2>&1 ||
  refuse 'CA root self-verification failed'
if [[ -e "$BASE" ]]; then
  [[ -d "$BASE" && ! -L "$BASE" && "$(stat -c %u "$BASE")" == 0 ]] ||
    refuse 'existing beta directory untrusted'
else
  install -d -o root -g root -m 0755 "$BASE"
fi
if [[ -e "$DEST_DIR" ]]; then
  [[ -d "$DEST_DIR" && ! -L "$DEST_DIR" && "$(stat -c %u "$DEST_DIR")" == 0 ]] ||
    refuse 'existing beta CA directory untrusted'
else
  install -d -o root -g root -m 0755 "$DEST_DIR"
fi

[[ ! -L "$TARGET" ]] || refuse 'target CA path cannot be a symlink'
if [[ -e "$TARGET" ]]; then
  [[ -f "$TARGET" && "$(stat -c %u "$TARGET")" == 0 ]] ||
    refuse 'existing CA destination not root owned'
  cmp -s "$SOURCE" "$TARGET" || refuse 'existing CA differs; manual rotation review required'
  chmod 0644 "$TARGET"
  printf '%s\n' 'BETA_PUBLIC_CA=already_staged_and_verified'
  exit 0
fi

temp="$(mktemp "$DEST_DIR/.crc-ca.XXXXXXXX")"
cleanup() { rm -f -- "$temp"; }
trap cleanup EXIT
install -o root -g root -m 0644 "$SOURCE" "$temp"
cmp -s "$SOURCE" "$temp" || refuse 'copied CA differs'
# Refuse if another operator placed a certificate in the meantime.
[[ ! -e "$TARGET" && ! -L "$TARGET" ]] || refuse 'target created concurrently'
mv -n -- "$temp" "$TARGET"
[[ -f "$TARGET" ]] && cmp -s "$SOURCE" "$TARGET" || refuse 'target verification failed'
printf '%s\n' 'BETA_PUBLIC_CA=staged_and_verified'
printf '%s\n' 'No database, service, port, private key, tunnel, or worker changed.'
