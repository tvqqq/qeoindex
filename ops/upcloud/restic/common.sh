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
}

heartbeat_request() {
  local url="$1" suffix="${2:-}"
  [[ -n "$url" ]] || return 0
  curl --fail --silent --show-error --max-time 10 --output /dev/null "${url}${suffix}"
}
heartbeat_start() { heartbeat_request "$1" /start; }
heartbeat_success() { heartbeat_request "$1"; }
heartbeat_fail() { heartbeat_request "$1" /fail; }
