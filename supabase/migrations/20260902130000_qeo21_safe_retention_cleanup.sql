begin;

-- QEO-21: safe telemetry/staging retention is deliberately independent from
-- raw market_ohlcv_history retention. Raw Daily OHLCV remains untouched until
-- Plan C archive hydration/restore is proven end-to-end.
create or replace function public.qeo_run_safe_retention_cleanup(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_started_at timestamptz := clock_timestamp();
  v_staging_cutoff timestamptz := p_reference_at - interval '7 days';
  v_llm_cutoff timestamptz := p_reference_at - interval '10 days';
  v_telemetry_cutoff timestamptz := p_reference_at - interval '30 days';
  v_council_cutoff timestamptz := p_reference_at - interval '45 days';
  v_deleted bigint := 0;
  v_phase_deleted bigint := 0;
  v_oldest timestamptz;
  v_expired_raw_evidence bigint := 0;
  v_oldest_expired_raw_evidence timestamptz;
  v_metrics jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('qeoindex.safe_retention_cleanup', 0));

  -- Staging is expected to disappear on successful publish. Keep seven days of
  -- terminal failed/completed evidence for debugging, but never touch a running run.
  delete from public.kfsp_rating_staging s
  using public.kfsp_rating_sync_runs r
  where r.id = s.sync_run_id
    and r.status in ('completed', 'failed')
    and s.fetched_at < v_staging_cutoff;
  get diagnostics v_deleted = row_count;
  select min(s.fetched_at) into v_oldest from public.kfsp_rating_staging s;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'kfsp_rating_staging',
    'cutoff', v_staging_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal-run staging, 7d'
  ));

  delete from public.market_insight_snapshot_staging s
  using public.market_insight_sync_runs r
  where r.id = s.run_id
    and r.status in ('completed', 'failed', 'skipped')
    and s.created_at < v_staging_cutoff;
  get diagnostics v_deleted = row_count;
  select min(s.created_at) into v_oldest from public.market_insight_snapshot_staging s;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'market_insight_snapshot_staging',
    'cutoff', v_staging_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal-run staging, 7d'
  ));

  -- AI Council LLM evidence is bounded telemetry/audit material. The evidence and
  -- research tables use captured_at (not created_at). Preserve any still-pending
  -- debate and only prune terminal debate rows.
  delete from public.ai_council_llm_evidence e
  where e.captured_at < v_llm_cutoff
    and not exists (
      select 1
      from public.ai_council_llm_debates d
      where d.run_id = e.run_id
        and d.ticker = e.ticker
        and d.status = 'pending'
    );
  get diagnostics v_deleted = row_count;
  select min(e.captured_at) into v_oldest from public.ai_council_llm_evidence e;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'ai_council_llm_evidence',
    'cutoff', v_llm_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', '10d, preserve pending debates'
  ));

  delete from public.ai_council_llm_research_contexts c
  where c.captured_at < v_llm_cutoff
    and not exists (
      select 1
      from public.ai_council_llm_debates d
      where d.run_id = c.run_id
        and d.ticker = c.ticker
        and d.status = 'pending'
    );
  get diagnostics v_deleted = row_count;
  select min(c.captured_at) into v_oldest from public.ai_council_llm_research_contexts c;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'ai_council_llm_research_contexts',
    'cutoff', v_llm_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', '10d, preserve pending debates'
  ));

  delete from public.ai_council_llm_debates d
  where d.created_at < v_llm_cutoff
    and d.status in ('completed', 'partial', 'failed');
  get diagnostics v_deleted = row_count;
  select min(d.created_at) into v_oldest from public.ai_council_llm_debates d;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'ai_council_llm_debates',
    'cutoff', v_llm_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal debate telemetry, 10d'
  ));

  -- Parent telemetry rows with cascading canonical children are only deleted when
  -- they are truly orphaned. This prevents retention from erasing Wyckoff outputs
  -- or AI Council outcomes/calibration evidence.
  delete from public.wyckoff_scan_runs r
  where r.requested_at < v_telemetry_cutoff
    and r.status in ('published', 'partial', 'failed')
    and not exists (
      select 1 from public.wyckoff_analysis_snapshots s where s.run_id = r.id
    )
    and not exists (
      select 1 from public.wyckoff_chart_series c where c.run_id = r.id
    );
  get diagnostics v_deleted = row_count;
  select min(r.requested_at) into v_oldest from public.wyckoff_scan_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'wyckoff_scan_runs',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal orphan runs, 30d'
  ));

  delete from public.ai_council_runs r
  where r.created_at < v_council_cutoff
    and not exists (
      select 1 from public.ai_council_outcomes o where o.run_id = r.id
    )
    and not exists (
      select 1 from public.ai_council_confirmations c
      where c.source_run_id = r.id or c.trigger_run_id = r.id
    )
    and not exists (
      select 1 from public.ai_council_votes v where v.run_id = r.id
    )
    and not exists (
      select 1 from public.ai_council_llm_debates d where d.run_id = r.id
    )
    and not exists (
      select 1 from public.ai_council_llm_evidence e where e.run_id = r.id
    )
    and not exists (
      select 1 from public.ai_council_llm_research_contexts c where c.run_id = r.id
    );
  get diagnostics v_deleted = row_count;
  select min(r.created_at) into v_oldest from public.ai_council_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'ai_council_runs',
    'cutoff', v_council_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'orphan deterministic runs only, 45d'
  ));

  -- Sync-run telemetry can be removed after its debug window. KFSP rating runs are
  -- retained while bounded raw evidence still points at their run id; the publisher
  -- remains the sole owner of raw-evidence deletion.
  delete from public.kfsp_rating_sync_runs r
  where r.created_at < v_telemetry_cutoff
    and r.status in ('completed', 'failed')
    and not exists (
      select 1 from public.kfsp_rating_staging s where s.sync_run_id = r.id
    )
    and not exists (
      select 1 from public.kfsp_rating_raw_evidence e where e.sync_run_id = r.id
    );
  get diagnostics v_deleted = row_count;
  select min(r.created_at) into v_oldest from public.kfsp_rating_sync_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'kfsp_rating_sync_runs',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal orphan runs, 30d'
  ));

  delete from public.kfsp_ttai_sync_runs r
  where r.started_at < v_telemetry_cutoff
    and r.status in ('completed', 'failed');
  get diagnostics v_deleted = row_count;
  select min(r.started_at) into v_oldest from public.kfsp_ttai_sync_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'kfsp_ttai_sync_runs',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal run telemetry, 30d'
  ));

  delete from public.market_insight_sync_runs r
  where r.created_at < v_telemetry_cutoff
    and r.status in ('completed', 'failed', 'skipped')
    and not exists (
      select 1 from public.market_insight_snapshot_staging s where s.run_id = r.id
    );
  get diagnostics v_deleted = row_count;
  select min(r.created_at) into v_oldest from public.market_insight_sync_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'market_insight_sync_runs',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal run telemetry, 30d; canonical FKs SET NULL'
  ));

  -- system_job_phases are telemetry children and are removed only through a
  -- terminal parent cascade. Count them first so the result reports both tables.
  select count(*) into v_phase_deleted
  from public.system_job_phases p
  join public.system_job_runs r on r.id = p.run_id
  where r.created_at < v_telemetry_cutoff
    and r.status in ('succeeded', 'failed', 'skipped');

  delete from public.system_job_runs r
  where r.created_at < v_telemetry_cutoff
    and r.status in ('succeeded', 'failed', 'skipped');
  get diagnostics v_deleted = row_count;
  select min(r.created_at) into v_oldest from public.system_job_runs r;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'system_job_runs',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'terminal job telemetry, 30d'
  ));
  select min(p.created_at) into v_oldest from public.system_job_phases p;
  v_metrics := v_metrics || jsonb_build_array(jsonb_build_object(
    'table', 'system_job_phases',
    'cutoff', v_telemetry_cutoff,
    'deletedRows', v_phase_deleted,
    'oldestRetainedAt', v_oldest,
    'policy', 'cascade with terminal system_job_runs, 30d'
  ));

  -- QEO-27 publisher owns deletion of kfsp_rating_raw_evidence. QEO-21 only
  -- monitors expiry so a stopped publisher cleanup becomes visible without two
  -- competing deletion owners.
  select count(*), min(expires_at)
  into v_expired_raw_evidence, v_oldest_expired_raw_evidence
  from public.kfsp_rating_raw_evidence
  where expires_at < p_reference_at;

  return jsonb_build_object(
    'status', 'succeeded',
    'referenceAt', p_reference_at,
    'durationMs', greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::bigint),
    'tables', v_metrics,
    'monitoring', jsonb_build_object(
      'kfsp_rating_raw_evidence', jsonb_build_object(
        'expiredRows', v_expired_raw_evidence,
        'oldestExpiredAt', v_oldest_expired_raw_evidence,
        'cutoff', p_reference_at,
        'owner', 'publish_kfsp_rating_snapshot'
      )
    ),
    'rawHistoryRetention', jsonb_build_object(
      'status', 'blocked',
      'table', 'market_ohlcv_history',
      'detail', 'Raw Daily OHLCV retention is intentionally disabled until Plan C cold-history hydration/restore is verified.'
    )
  );
end;
$function$;

revoke all on function public.qeo_run_safe_retention_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_run_safe_retention_cleanup(timestamptz) to service_role;

comment on function public.qeo_run_safe_retention_cleanup(timestamptz) is
  'QEO-21 service-role-only idempotent telemetry/staging cleanup. Never age-prunes market_ohlcv_history.';

commit;
