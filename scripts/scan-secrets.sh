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
check_pattern "hard-coded sensitive environment value" '(DNSE_API_(KEY|SECRET)|API_(KEY|SECRET)|api(Key|Secret)|TELEGRAM_BOT_TOKEN|NOTION_API_KEY|FINHAY_OAUTH_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|UPSTASH_REDIS_REST_TOKEN|KFSP_PASSWORD|KFSP_SYNC_SECRET|MARKET_SYNC_SECRET|MARKET_SYNC_SECRET_PREVIOUS|MARKET_CACHE_ADMIN_SECRET|AI_COUNCIL_RUN_SECRET|CRON_SECRET|SCANNER_RUN_SECRET|SIGNAL_MONITOR_SECRET|QSTASH_TOKEN|QSTASH_CURRENT_SIGNING_KEY|QSTASH_NEXT_SIGNING_KEY)[[:space:]]*[:=][[:space:]]*["'"'][^"'"']+["'"']'
check_pattern "committed dotenv-style sensitive value" '^[[:space:]]*(DNSE_API_(KEY|SECRET)|TELEGRAM_BOT_TOKEN|NOTION_API_KEY|FINHAY_OAUTH_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|UPSTASH_REDIS_REST_TOKEN|KFSP_PASSWORD|KFSP_SYNC_SECRET|MARKET_SYNC_SECRET|MARKET_SYNC_SECRET_PREVIOUS|MARKET_CACHE_ADMIN_SECRET|AI_COUNCIL_RUN_SECRET|CRON_SECRET|SCANNER_RUN_SECRET|SIGNAL_MONITOR_SECRET|QSTASH_TOKEN|QSTASH_CURRENT_SIGNING_KEY|QSTASH_NEXT_SIGNING_KEY)[[:space:]]*=[[:space:]]*[^[:space:]#][^[:space:]]*'
check_pattern "private key material" '[B]EGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
check_pattern "known provider token prefix" '(ghp_|github_pat_|glpat-|sk_live_|sk_test_|xox[baprs]-|sb_secret_)[A-Za-z0-9_-]{12,}'
check_pattern "PostgreSQL credential URL" 'postgres(ql)?://[^[:space:]/:@]+:[^[:space:]@]+@[^[:space:]]+'

if (( failed )); then
  echo "Only filenames are shown to avoid echoing credential values into CI logs."
  exit 1
fi

echo "Secret scan passed."
