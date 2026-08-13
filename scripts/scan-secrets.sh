#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

failed=0

check_pattern() {
  local description="$1"
  local pattern="$2"
  local matches

  matches="$(git grep -I -l -E "$pattern" -- . \
    ':!scripts/scan-secrets.sh' || true)"

  if [[ -n "$matches" ]]; then
    echo "Secret scan failed: $description"
    echo "$matches"
    failed=1
  fi
}

# Keep patterns split so this scanner does not flag its own source.
check_pattern "browser-exposed DNSE environment variable" '[N]EXT_PUBLIC_DNSE_(API_KEY|API_SECRET)'
check_pattern "hard-coded sensitive environment value" '(DNSE_API_(KEY|SECRET)|API_(KEY|SECRET)|api(Key|Secret)|TELEGRAM_BOT_TOKEN|NOTION_API_KEY|FINHAY_OAUTH_CLIENT_SECRET|CRON_SECRET|SCANNER_RUN_SECRET|SIGNAL_MONITOR_SECRET)[[:space:]]*[:=][[:space:]]*["'"'][^"'"']+["'"']'
check_pattern "private key material" '[B]EGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
check_pattern "known provider token prefix" '(ghp_|github_pat_|glpat-|sk_live_|sk_test_|xox[baprs]-)[A-Za-z0-9_-]{12,}'

if (( failed )); then
  echo "Only filenames are shown to avoid echoing credential values into CI logs."
  exit 1
fi

echo "Secret scan passed."
