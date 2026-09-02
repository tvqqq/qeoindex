#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
TARGET_ENV="${TARGET_ENV:-}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
DATABASE_URL="${DATABASE_URL:-}"
SCHEMA="qeo_recovery_rehearsal"
WORK_DIR="${RECOVERY_REHEARSAL_DIR:-$(pwd)/.tmp/qeo-26-recovery-rehearsal}"

fail() {
  echo "QEO-26 recovery rehearsal refused: $*" >&2
  exit 2
}

case "${TARGET_ENV}" in
  local|development|staging|rehearsal) ;;
  "") fail "TARGET_ENV is required and must identify an explicit non-production target" ;;
  *) fail "TARGET_ENV=${TARGET_ENV} is not an approved non-production rehearsal environment" ;;
esac

[[ -n "${DATABASE_URL}" ]] || fail "DATABASE_URL is required"
[[ "${SUPABASE_PROJECT_REF}" != "${PRODUCTION_PROJECT_REF}" ]] || fail "production project ref is forbidden"
[[ "${DATABASE_URL}" != *"${PRODUCTION_PROJECT_REF}"* ]] || fail "production database host/ref is forbidden"

command -v psql >/dev/null 2>&1 || fail "psql is required"
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

mkdir -p "${WORK_DIR}"
SCHEMA_DUMP="${WORK_DIR}/schema.sql"
DATA_DUMP="${WORK_DIR}/data.sql"
BEFORE_META="${WORK_DIR}/before-meta.txt"
AFTER_META="${WORK_DIR}/after-meta.txt"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};

CREATE TABLE ${SCHEMA}.insights_stock_ratings_rehearsal (
  ticker text PRIMARY KEY,
  score_4m numeric,
  kfsp_score_4m numeric NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ${SCHEMA}.wyckoff_universe_memberships_rehearsal (
  run_id uuid NOT NULL,
  ticker text NOT NULL,
  rank integer NOT NULL,
  PRIMARY KEY (run_id, ticker)
);

ALTER TABLE ${SCHEMA}.wyckoff_universe_memberships_rehearsal ENABLE ROW LEVEL SECURITY;
CREATE POLICY rehearsal_membership_read
  ON ${SCHEMA}.wyckoff_universe_memberships_rehearsal
  FOR SELECT
  USING (true);
GRANT SELECT ON ${SCHEMA}.wyckoff_universe_memberships_rehearsal TO public;
GRANT SELECT ON ${SCHEMA}.insights_stock_ratings_rehearsal TO public;

CREATE VIEW ${SCHEMA}.rating_parity_view AS
SELECT ticker, score_4m, kfsp_score_4m
FROM ${SCHEMA}.insights_stock_ratings_rehearsal;

CREATE FUNCTION ${SCHEMA}.rating_row_count()
RETURNS bigint
LANGUAGE sql
STABLE
AS \$\$
  SELECT count(*) FROM ${SCHEMA}.insights_stock_ratings_rehearsal
\$\$;

INSERT INTO ${SCHEMA}.insights_stock_ratings_rehearsal (ticker, score_4m, kfsp_score_4m, raw_payload)
VALUES
  ('AAA', 71.5, 71.5, '{"provider":"fixture-a"}'::jsonb),
  ('BBB', 64.0, 64.0, '{"provider":"fixture-b"}'::jsonb);

INSERT INTO ${SCHEMA}.wyckoff_universe_memberships_rehearsal (run_id, ticker, rank)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'AAA', 1),
  ('11111111-1111-4111-8111-111111111111', 'BBB', 2);
SQL

# BACKUP must happen before any representative destructive DDL.
pg_dump --schema-only --no-owner --no-privileges --schema="${SCHEMA}" "${DATABASE_URL}" > "${SCHEMA_DUMP}"
pg_dump --data-only --no-owner --schema="${SCHEMA}" "${DATABASE_URL}" > "${DATA_DUMP}"
sha256sum "${SCHEMA_DUMP}" "${DATA_DUMP}" > "${WORK_DIR}/backup.sha256"

psql "${DATABASE_URL}" -At -v ON_ERROR_STOP=1 <<SQL > "${BEFORE_META}"
SELECT 'ratings_row_count=' || count(*) FROM ${SCHEMA}.insights_stock_ratings_rehearsal;
SELECT 'membership_row_count=' || count(*) FROM ${SCHEMA}.wyckoff_universe_memberships_rehearsal;
SELECT 'rating_parity_mismatch=' || count(*) FROM ${SCHEMA}.insights_stock_ratings_rehearsal WHERE score_4m IS DISTINCT FROM kfsp_score_4m;
SELECT 'rls=' || relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${SCHEMA}' AND c.relname='wyckoff_universe_memberships_rehearsal';
SELECT 'policy_count=' || count(*) FROM pg_policies WHERE schemaname='${SCHEMA}' AND tablename='wyckoff_universe_memberships_rehearsal';
SELECT 'public_select_grant=' || count(*) FROM information_schema.role_table_grants WHERE table_schema='${SCHEMA}' AND table_name='wyckoff_universe_memberships_rehearsal' AND grantee='PUBLIC' AND privilege_type='SELECT';
SELECT 'view_count=' || count(*) FROM information_schema.views WHERE table_schema='${SCHEMA}' AND table_name='rating_parity_view';
SELECT 'function_count=' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${SCHEMA}' AND p.proname='rating_row_count';
SQL

# Representative destructive changes: dropped legacy column + dropped legacy bridge table.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
ALTER TABLE ${SCHEMA}.insights_stock_ratings_rehearsal DROP COLUMN score_4m CASCADE;
DROP TABLE ${SCHEMA}.wyckoff_universe_memberships_rehearsal CASCADE;
SQL

psql "${DATABASE_URL}" -At -v ON_ERROR_STOP=1 <<SQL
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='${SCHEMA}' AND table_name='insights_stock_ratings_rehearsal' AND column_name='score_4m'
) THEN pg_catalog.raise_exception('legacy column was not dropped') ELSE 'destructive_column_drop=PASS' END;
SQL

if psql "${DATABASE_URL}" -Atqc "SELECT to_regclass('${SCHEMA}.wyckoff_universe_memberships_rehearsal') IS NOT NULL" | grep -qx 't'; then
  fail "representative DROP TABLE did not remove the legacy table"
fi

# RESTORE from the verified backup by recreating the fixture schema and data.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${SCHEMA_DUMP}"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${DATA_DUMP}"

psql "${DATABASE_URL}" -At -v ON_ERROR_STOP=1 <<SQL > "${AFTER_META}"
SELECT 'ratings_row_count=' || count(*) FROM ${SCHEMA}.insights_stock_ratings_rehearsal;
SELECT 'membership_row_count=' || count(*) FROM ${SCHEMA}.wyckoff_universe_memberships_rehearsal;
SELECT 'rating_parity_mismatch=' || count(*) FROM ${SCHEMA}.insights_stock_ratings_rehearsal WHERE score_4m IS DISTINCT FROM kfsp_score_4m;
SELECT 'rls=' || relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${SCHEMA}' AND c.relname='wyckoff_universe_memberships_rehearsal';
SELECT 'policy_count=' || count(*) FROM pg_policies WHERE schemaname='${SCHEMA}' AND tablename='wyckoff_universe_memberships_rehearsal';
SELECT 'public_select_grant=' || count(*) FROM information_schema.role_table_grants WHERE table_schema='${SCHEMA}' AND table_name='wyckoff_universe_memberships_rehearsal' AND grantee='PUBLIC' AND privilege_type='SELECT';
SELECT 'view_count=' || count(*) FROM information_schema.views WHERE table_schema='${SCHEMA}' AND table_name='rating_parity_view';
SELECT 'function_count=' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${SCHEMA}' AND p.proname='rating_row_count';
SQL

cmp -s "${BEFORE_META}" "${AFTER_META}" || {
  echo "QEO-26 parity FAILED" >&2
  diff -u "${BEFORE_META}" "${AFTER_META}" >&2 || true
  exit 1
}

grep -qx 'ratings_row_count=2' "${AFTER_META}"
grep -qx 'membership_row_count=2' "${AFTER_META}"
grep -qx 'rating_parity_mismatch=0' "${AFTER_META}"
grep -qx 'rls=true' "${AFTER_META}"
grep -qx 'policy_count=1' "${AFTER_META}"
grep -qx 'public_select_grant=1' "${AFTER_META}"
grep -qx 'view_count=1' "${AFTER_META}"
grep -qx 'function_count=1' "${AFTER_META}"

sha256sum -c "${WORK_DIR}/backup.sha256"
echo "QEO-26 recovery rehearsal PASS"
echo "Evidence: ${WORK_DIR}"
