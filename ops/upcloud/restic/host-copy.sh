#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

copy_dir() {
  local stage="$1" src="$2"; shift 2
  [[ -d "$src" ]] || return 0
  local dest="$stage/${src#/}"
  install -d -m 0700 "$dest"
  rsync -a "$@" "$src/" "$dest/"
}

copy_file() {
  local stage="$1" src="$2"
  [[ -f "$src" ]] || return 0
  local dest="$stage/${src#/}"
  install -d -m 0700 "$(dirname "$dest")"
  rsync -a "$src" "$dest"
}

stage_hermes_data() {
  local stage="$1"
  [[ "$stage" == /var/lib/qeo-backup/stage/* ]] || { echo "Unsafe stage root" >&2; return 64; }
  [[ -d /opt/hermes/data ]] || { echo "Required source /opt/hermes/data is missing" >&2; return 66; }
  install -d -m 0700 "$stage"
  copy_dir "$stage" /opt/hermes/data
}

build_stage() {
  local stage="$1"
  [[ "$stage" == /var/lib/qeo-backup/stage/* ]] || { echo "Unsafe stage root" >&2; return 64; }
  [[ -d "$stage/opt/hermes/data" ]] || { echo "Hermes staged data is missing" >&2; return 66; }
  install -d -m 0700 "$stage"

  copy_dir "$stage" /opt/hermes/deploy --exclude='.env' --exclude='*.env'
  copy_dir "$stage" /opt/qeoindex/deploy

  local path
  shopt -s nullglob
  for path in /etc/systemd/system/qeo-*.service /etc/systemd/system/qeo-*.timer /usr/local/bin/qeo-* /usr/local/sbin/qeo-*; do
    copy_file "$stage" "$path"
  done
  shopt -u nullglob

  copy_file "$stage" /etc/ssh/sshd_config
  copy_dir "$stage" /etc/ssh/sshd_config.d --exclude='ssh_host_*'
  copy_file "$stage" /etc/ufw/user.rules
  copy_file "$stage" /etc/ufw/user6.rules
  copy_file "$stage" /etc/sudoers.d/hermes-qeo
  copy_file "$stage" /etc/docker/daemon.json

  # Explicit non-sources: /opt/qeoindex/env, /etc/ssh/ssh_host_*, /var/lib/docker,
  # repository source, logs, caches, database dumps, and arbitrary home state.
}
