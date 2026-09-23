#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RUNTIME_ENV=/etc/restic/qeoindex/runtime.env
PASSWORD_FILE=/etc/restic/qeoindex/repository-password

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "QEO-202 requires root" >&2
    return 77
  fi
}

validate_secret_file() {
  local path="$1"
  [[ -f "$path" ]] || { echo "Missing required secret file: $path" >&2; return 78; }
  [[ "$(stat -c '%U:%G' "$path")" == "root:root" ]] || { echo "Invalid owner for $path" >&2; return 78; }
  [[ "$(stat -c '%a' "$path")" == "600" ]] || { echo "Invalid mode for $path; expected 600" >&2; return 78; }
}

source_restic_runtime() {
  require_root
  validate_secret_file "$RUNTIME_ENV"
  validate_secret_file "$PASSWORD_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$RUNTIME_ENV"
  set +a
  export RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
  : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
  export QEO_RESTIC_BACKUP_HOST="${QEO_RESTIC_BACKUP_HOST:-qeo-upcloud-operational}"
  export QEO_RESTIC_BACKUP_TAG="${QEO_RESTIC_BACKUP_TAG:-qeo-upcloud-operational}"
  [[ "$QEO_RESTIC_BACKUP_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid QEO_RESTIC_BACKUP_HOST" >&2; return 78; }
  [[ "$QEO_RESTIC_BACKUP_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid QEO_RESTIC_BACKUP_TAG" >&2; return 78; }
}

heartbeat_request() {
  local url="$1" suffix="${2:-}"
  [[ -n "$url" ]] || return 0
  curl --fail --silent --show-error --max-time 10 --output /dev/null "${url}${suffix}"
}
heartbeat_start() { heartbeat_request "$1" /start; }
heartbeat_success() { heartbeat_request "$1"; }
heartbeat_fail() { heartbeat_request "$1" /fail; }
HERMES_RUNTIME_USER=hermes

discover_hermes_gateway_unit() {
  local uid system_units user_units refs count
  uid="$(id -u "$HERMES_RUNTIME_USER")"
  system_units="$(systemctl list-unit-files 'hermes-gateway-*.service' --no-legend --no-pager \
    | awk '$1 ~ /^hermes-gateway-.*\.service$/ {print $1}' | sort -u)"
  user_units="$(runuser -u "$HERMES_RUNTIME_USER" -- env "XDG_RUNTIME_DIR=/run/user/$uid" \
    systemctl --user list-unit-files 'hermes-gateway-*.service' --no-legend --no-pager \
    | awk '$1 ~ /^hermes-gateway-.*\.service$/ {print $1}' | sort -u)"
  refs="$(
    { printf '%s\n' "$system_units" | sed '/^$/d' | sed 's/^/system|/'; \
      printf '%s\n' "$user_units" | sed '/^$/d' | sed 's/^/user|/'; } | sort -u
  )"
  count="$(printf '%s\n' "$refs" | sed '/^$/d' | wc -l | tr -d ' ')"
  [[ "$count" -eq 1 ]] || { echo "Expected exactly one Hermes gateway unit; found $count" >&2; return 69; }
  printf '%s\n' "$refs"
}

hermes_user_systemctl() {
  local action="$1" unit="$2" uid
  uid="$(id -u "$HERMES_RUNTIME_USER")"
  runuser -u "$HERMES_RUNTIME_USER" -- env "XDG_RUNTIME_DIR=/run/user/$uid" \
    systemctl --user "$action" "$unit"
}

hermes_gateway_systemctl() {
  local action="$1" ref="$2" scope unit
  scope="${ref%%|*}"
  unit="${ref#*|}"
  case "$scope" in
    system) systemctl "$action" "$unit" ;;
    user) hermes_user_systemctl "$action" "$unit" ;;
    *) echo "Invalid Hermes gateway reference: $ref" >&2; return 69 ;;
  esac
}

hermes_gateway_stop() { hermes_gateway_systemctl stop "$1"; }
hermes_gateway_start() { hermes_gateway_systemctl start "$1"; }
