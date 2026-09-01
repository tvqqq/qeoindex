begin;

-- One-shot clean rebuild for the canonical vn_top_stocks operational dataset.
--
-- This migration intentionally removes only state that can be rebuilt from the
-- canonical KFSP source snapshot + providers. It does NOT delete provider/source
-- evidence, user/auth/config data, audit telemetry, or verified cold-archive
-- coverage.
--
-- Rebuild order after this migration:
--   1. qeo_trigger_market_universe_monthly()
--   2. wait for a newly published vn_top_stocks run
--   3. qeo_trigger_eod_pipeline()
--   4. verify Daily raw history + 1D/1W Wyckoff exact membership

select pg_advisory_xact_lock(hashtextextended('qeoindex.clean_rebuild_top_stocks_200', 0));

-- Fail closed rather than deleting state underneath an active canonical publisher
-- or EOD workflow. Historical system_job_runs/system_job_phases are audit evidence
-- and are deliberately preserved.
do $$
begin
  if exists (
    select 1
    from public.system_job_runs
    where status = 'running'
      and job_key in ('market.universe_monthly', 'qeoindex.eod_pipeline')
  ) then
    raise exception 'Clean rebuild refused: canonical universe/EOD job is currently running';
  end if;
end;
$$;

-- Advisory AI output derived from disposable stock snapshots. Calibration history
-- (ai_council_agent_stats / ai_council_market_benchmarks) is retained because it is
-- historical evidence rather than current-universe materialization.
truncate table
  public.ai_council_confirmations,
  public.ai_council_llm_debates,
  public.ai_council_llm_evidence,
  public.ai_council_llm_research_contexts,
  public.ai_council_outcomes,
  public.ai_council_votes,
  public.ai_council_runs
restart identity cascade;

-- Current Wyckoff operational materialization. A fresh EOD run rebuilds it from
-- canonical Daily raw history and derives Weekly deterministically.
truncate table
  public.wyckoff_analysis_snapshots,
  public.wyckoff_chart_series,
  public.wyckoff_universe_memberships,
  public.wyckoff_scan_runs
restart identity cascade;

-- Realtime/current projections must not retain membership from the old universe.
truncate table public.stock_orderbook_snapshots restart identity cascade;

-- Force every member of the freshly published universe through the current Daily
-- bootstrap contract. This removes both old Top100 raw data and any partial new
-- bootstrap state so the rebuild is truly from zero.
truncate table
  public.market_ohlcv_bootstrap_state,
  public.market_ohlcv_history
restart identity cascade;

-- Universe memberships/runs themselves are disposable publisher output. Source
-- KFSP ratings are intentionally retained because market-universe-sync selects the
-- fresh 200 from the latest published provider snapshot.
truncate table
  public.market_universe_memberships,
  public.market_universe_runs
restart identity cascade;

-- Cached TTAI synchronization cursor is rebuildable. Quarterly provider history
-- and its sync-run audit trail are preserved.
truncate table public.kfsp_ttai_sync_state restart identity cascade;

-- Market synthesis conclusions are generated from current-session evidence and
-- must not survive a clean stock-data rebuild. Historical market insight source
-- snapshots remain available as source evidence.
truncate table public.market_ai_conclusions restart identity cascade;

-- Archive checkpoints describe operational completion for a specific universe
-- run. They are rebuilt after the new run; verified cold archive range coverage is
-- deliberately preserved in market_ohlcv_archive_ranges.
truncate table public.eod_archive_checkpoints restart identity cascade;

-- The destructive purge makes the previously NOT VALID cutover constraints safe
-- to validate. From this point onward the physical hot store matches the active
-- contract rather than merely rejecting new legacy writes.
alter table public.market_ohlcv_history
  validate constraint market_ohlcv_history_timeframe_check;

alter table public.wyckoff_analysis_snapshots
  validate constraint wyckoff_analysis_snapshots_timeframe_check;

alter table public.wyckoff_chart_series
  validate constraint wyckoff_chart_series_timeframe_check;

-- Canonical contracts retained after the clean slate:
--   raw OHLCV: check (timeframe = '1D')
--   Wyckoff:   check (timeframe in ('1D', '1W'))

commit;
