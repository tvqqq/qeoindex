-- QEO-143 — conservative legacy Portfolio migration/backfill.
-- Raw portfolio_transactions remain the AVCO/accounting source of truth.
-- Unknown legacy facts stay unknown: no fabricated mode, execution timestamp,
-- stop history, risk snapshot, psychology, journal history, or plan provenance.

begin;

alter table public.portfolio_transactions
  add column record_origin text not null default 'native'
    check (record_origin in ('native', 'legacy_pre_trade_domain')),
  add column legacy_migration_status text not null default 'not_applicable'
    check (legacy_migration_status in (
      'not_applicable',
      'legacy_ungrouped',
      'deterministic_grouped',
      'manually_reviewed'
    ));

-- Existing unlinked rows are pre-QEO-143 records whose Trade provenance was not
-- captured. This marks only migration provenance; it does not infer a Trade.
update public.portfolio_transactions
set record_origin = 'legacy_pre_trade_domain',
    legacy_migration_status = 'legacy_ungrouped'
where trade_id is null;

alter table public.portfolio_trades
  add column origin text not null default 'native'
    check (origin in ('native', 'legacy_migration')),
  add column grouping_status text not null default 'native'
    check (grouping_status in ('native', 'deterministic', 'manually_reviewed')),
  add column scorecard_eligible boolean not null default true,
  add column legacy_opened_on date,
  add column legacy_closed_on date,
  add column legacy_source_transaction_count integer
    check (legacy_source_transaction_count is null or legacy_source_transaction_count > 0);

-- Persisted migration records need an explicit unknown mode. Normal Trade-create
-- validation remains live|paper in application code; unknown is migration-only.
alter table public.portfolio_trades
  drop constraint portfolio_trades_mode_check;

alter table public.portfolio_trades
  add constraint portfolio_trades_mode_check
  check (mode in ('live', 'paper', 'unknown'));

-- Preserve the existing native lifecycle invariant while allowing a migrated
-- closed campaign to carry date-only evidence instead of fabricated timestamps.
alter table public.portfolio_trades
  drop constraint portfolio_trades_check;

alter table public.portfolio_trades
  add constraint portfolio_trades_check
  check (
    (
      origin = 'native'
      and grouping_status = 'native'
      and mode in ('live', 'paper')
      and legacy_opened_on is null
      and legacy_closed_on is null
      and legacy_source_transaction_count is null
      and (
        (status = 'planned' and opened_at is null and closed_at is null)
        or (status = 'cancelled' and opened_at is null and closed_at is null)
        or (status in ('open', 'partially_closed') and opened_at is not null and closed_at is null)
        or (
          status = 'closed'
          and opened_at is not null
          and closed_at is not null
          and closed_at >= opened_at
        )
      )
    )
    or
    (
      origin = 'legacy_migration'
      and grouping_status in ('deterministic', 'manually_reviewed')
      and status = 'closed'
      and legacy_opened_on is not null
      and legacy_closed_on is not null
      and legacy_closed_on >= legacy_opened_on
      and legacy_source_transaction_count is not null
      and (
        (
          opened_at is null
          and closed_at is null
        )
        or (
          opened_at is not null
          and closed_at is not null
          and closed_at >= opened_at
        )
      )
    )
  );

alter table public.portfolio_trades
  add constraint portfolio_trades_migration_provenance_check
  check (
    (origin = 'native' and grouping_status = 'native' and mode in ('live', 'paper'))
    or
    (origin = 'legacy_migration' and grouping_status in ('deterministic', 'manually_reviewed'))
  );

alter table public.portfolio_transactions
  add constraint portfolio_transactions_legacy_provenance_check
  check (
    (record_origin = 'native' and legacy_migration_status = 'not_applicable')
    or
    (
      record_origin = 'legacy_pre_trade_domain'
      and legacy_migration_status in ('legacy_ungrouped', 'deterministic_grouped', 'manually_reviewed')
    )
  );

create index portfolio_transactions_legacy_migration_idx
  on public.portfolio_transactions(
    user_id,
    portfolio_id,
    ticker,
    legacy_migration_status,
    transaction_date,
    created_at,
    id
  )
  where record_origin = 'legacy_pre_trade_domain';

create index portfolio_trades_legacy_migration_idx
  on public.portfolio_trades(user_id, portfolio_id, grouping_status, legacy_closed_on, id)
  where origin = 'legacy_migration';

create table public.qeo143_legacy_migration_audit (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  rows_scanned bigint not null check (rows_scanned >= 0),
  rows_grouped bigint not null check (rows_grouped >= 0),
  trades_created bigint not null check (trades_created >= 0),
  rows_unresolved bigint not null check (rows_unresolved >= 0),
  buy_quantity_before numeric not null default 0,
  buy_quantity_after numeric not null default 0,
  sell_quantity_before numeric not null default 0,
  sell_quantity_after numeric not null default 0,
  notional_before numeric not null default 0,
  notional_after numeric not null default 0,
  fees_before numeric not null default 0,
  fees_after numeric not null default 0,
  completed_at timestamptz not null default now()
);

alter table public.qeo143_legacy_migration_audit enable row level security;
revoke all on table public.qeo143_legacy_migration_audit from public, anon, authenticated;
grant select, insert on table public.qeo143_legacy_migration_audit to service_role;

create or replace function public.qeo143_backfill_legacy_portfolio_trades()
returns table (
  audit_id uuid,
  rows_scanned bigint,
  rows_grouped bigint,
  trades_created bigint,
  rows_unresolved bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope record;
  v_tx record;
  v_open_qty numeric;
  v_last_closed_on date;
  v_scope_valid boolean;
  v_campaign_ids uuid[];
  v_campaign_opened_on date;
  v_trade_id uuid;
  v_rows_scanned bigint := 0;
  v_rows_grouped bigint := 0;
  v_trades_created bigint := 0;
  v_rows_unresolved bigint := 0;
  v_buy_quantity_before numeric := 0;
  v_buy_quantity_after numeric := 0;
  v_sell_quantity_before numeric := 0;
  v_sell_quantity_after numeric := 0;
  v_notional_before numeric := 0;
  v_notional_after numeric := 0;
  v_fees_before numeric := 0;
  v_fees_after numeric := 0;
  v_audit_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('qeo143_backfill_legacy_portfolio_trades'));

  select
    count(*) filter (where legacy_migration_status = 'legacy_ungrouped'),
    coalesce(sum(quantity) filter (where action = 'buy'), 0),
    coalesce(sum(quantity) filter (where action = 'sell'), 0),
    coalesce(sum(price * quantity), 0),
    coalesce(sum(fee), 0)
  into
    v_rows_scanned,
    v_buy_quantity_before,
    v_sell_quantity_before,
    v_notional_before,
    v_fees_before
  from public.portfolio_transactions
  where record_origin = 'legacy_pre_trade_domain';

  for v_scope in
    select user_id, portfolio_id, ticker
    from public.portfolio_transactions
    where record_origin = 'legacy_pre_trade_domain'
      and legacy_migration_status = 'legacy_ungrouped'
      and trade_id is null
    group by user_id, portfolio_id, ticker
    order by user_id, portfolio_id, ticker
  loop
    v_open_qty := 0;
    v_last_closed_on := null;
    v_scope_valid := true;

    -- First pass: prove the remaining scope is unambiguous before writing any link.
    for v_tx in
      select id, action, quantity, transaction_date, created_at
      from public.portfolio_transactions
      where user_id = v_scope.user_id
        and portfolio_id = v_scope.portfolio_id
        and ticker = v_scope.ticker
        and record_origin = 'legacy_pre_trade_domain'
        and legacy_migration_status = 'legacy_ungrouped'
        and trade_id is null
      order by transaction_date asc, created_at asc, id asc
    loop
      if v_tx.action not in ('buy', 'sell') then
        v_scope_valid := false;
        exit;
      end if;

      if v_tx.quantity is null or v_tx.quantity <= 0 then
        v_scope_valid := false;
        exit;
      end if;

      if v_tx.action = 'buy' then
        -- Re-opening after a close on the same date would require an execution
        -- time we do not have. Leave the entire scope unresolved.
        if v_open_qty = 0 and v_last_closed_on = v_tx.transaction_date then
          v_scope_valid := false;
          exit;
        end if;
        v_open_qty := v_open_qty + v_tx.quantity;
      else
        if v_open_qty <= 0 or v_tx.quantity > v_open_qty then
          v_scope_valid := false;
          exit;
        end if;
        v_open_qty := v_open_qty - v_tx.quantity;
        if v_open_qty = 0 then
          v_last_closed_on := v_tx.transaction_date;
        end if;
      end if;
    end loop;

    if not v_scope_valid then
      continue;
    end if;

    -- Second pass: group only completed campaigns. A terminal open tail remains
    -- legacy_ungrouped and therefore Risk/Scorecard-incomplete.
    v_open_qty := 0;
    v_campaign_ids := array[]::uuid[];
    v_campaign_opened_on := null;

    for v_tx in
      select id, action, quantity, transaction_date, created_at
      from public.portfolio_transactions
      where user_id = v_scope.user_id
        and portfolio_id = v_scope.portfolio_id
        and ticker = v_scope.ticker
        and record_origin = 'legacy_pre_trade_domain'
        and legacy_migration_status = 'legacy_ungrouped'
        and trade_id is null
      order by transaction_date asc, created_at asc, id asc
    loop
      if v_open_qty = 0 then
        v_campaign_ids := array[]::uuid[];
        v_campaign_opened_on := v_tx.transaction_date;
      end if;

      v_campaign_ids := array_append(v_campaign_ids, v_tx.id);
      if v_tx.action = 'buy' then
        v_open_qty := v_open_qty + v_tx.quantity;
      else
        v_open_qty := v_open_qty - v_tx.quantity;
      end if;

      if v_open_qty = 0 then
        insert into public.portfolio_trades (
          portfolio_id,
          user_id,
          ticker,
          mode,
          status,
          origin,
          grouping_status,
          scorecard_eligible,
          legacy_opened_on,
          legacy_closed_on,
          legacy_source_transaction_count
        )
        values (
          v_scope.portfolio_id,
          v_scope.user_id,
          v_scope.ticker,
          'unknown',
          'closed',
          'legacy_migration',
          'deterministic',
          false,
          v_campaign_opened_on,
          v_tx.transaction_date,
          cardinality(v_campaign_ids)
        )
        returning id into v_trade_id;

        update public.portfolio_transactions
        set trade_id = v_trade_id,
            legacy_migration_status = 'deterministic_grouped'
        where id = any(v_campaign_ids)
          and user_id = v_scope.user_id
          and portfolio_id = v_scope.portfolio_id
          and ticker = v_scope.ticker
          and trade_id is null
          and record_origin = 'legacy_pre_trade_domain'
          and legacy_migration_status = 'legacy_ungrouped';

        get diagnostics v_rows_unresolved = row_count;
        v_rows_grouped := v_rows_grouped + v_rows_unresolved;
        v_trades_created := v_trades_created + 1;
        v_rows_unresolved := 0;
        v_campaign_ids := array[]::uuid[];
        v_campaign_opened_on := null;
      end if;
    end loop;
  end loop;

  select
    count(*) filter (where legacy_migration_status = 'legacy_ungrouped'),
    coalesce(sum(quantity) filter (where action = 'buy'), 0),
    coalesce(sum(quantity) filter (where action = 'sell'), 0),
    coalesce(sum(price * quantity), 0),
    coalesce(sum(fee), 0)
  into
    v_rows_unresolved,
    v_buy_quantity_after,
    v_sell_quantity_after,
    v_notional_after,
    v_fees_after
  from public.portfolio_transactions
  where record_origin = 'legacy_pre_trade_domain';

  if v_buy_quantity_before is distinct from v_buy_quantity_after
    or v_sell_quantity_before is distinct from v_sell_quantity_after
    or v_notional_before is distinct from v_notional_after
    or v_fees_before is distinct from v_fees_after
  then
    raise exception 'QEO-143 reconciliation mismatch: raw portfolio transaction accounting changed';
  end if;

  insert into public.qeo143_legacy_migration_audit (
    run_key,
    rows_scanned,
    rows_grouped,
    trades_created,
    rows_unresolved,
    buy_quantity_before,
    buy_quantity_after,
    sell_quantity_before,
    sell_quantity_after,
    notional_before,
    notional_after,
    fees_before,
    fees_after
  )
  values (
    '20260909050000_qeo143_legacy_portfolio_migration',
    v_rows_scanned,
    v_rows_grouped,
    v_trades_created,
    v_rows_unresolved,
    v_buy_quantity_before,
    v_buy_quantity_after,
    v_sell_quantity_before,
    v_sell_quantity_after,
    v_notional_before,
    v_notional_after,
    v_fees_before,
    v_fees_after
  )
  returning id into v_audit_id;

  return query
  select v_audit_id, v_rows_scanned, v_rows_grouped, v_trades_created, v_rows_unresolved;
end;
$$;

revoke all on function public.qeo143_backfill_legacy_portfolio_trades() from public, anon, authenticated;
grant execute on function public.qeo143_backfill_legacy_portfolio_trades() to service_role;

-- One conservative pass during migration. The function is intentionally
-- idempotent so an operator can re-run it after a dry-run/reconciliation check.
select * from public.qeo143_backfill_legacy_portfolio_trades();

commit;
