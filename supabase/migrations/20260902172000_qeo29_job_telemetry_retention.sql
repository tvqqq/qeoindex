begin;

-- QEO-29: execution telemetry is operational debug data, not long-lived audit data.
-- Keep detailed EOD/job phases for one day and terminal run summaries for seven days.
-- Active queued/running lifecycles are never eligible for cleanup.
create or replace function public.qeo_run_job_telemetry_cleanup(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_started_at timestamptz := clock_timestamp();
  v_phase_cutoff timestamptz := p_reference_at - interval '1 day';
  v_job_cutoff timestamptz := p_reference_at - interval '7 days';
  v_phase_deleted bigint := 0;
  v_run_deleted bigint := 0;
  v_oldest_phase timestamptz;
  v_oldest_run timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('qeoindex.job_telemetry_cleanup', 0));

  delete from public.system_job_phases p
  using public.system_job_runs r
  where r.id = p.run_id
    and r.status in ('succeeded', 'failed', 'skipped')
    and coalesce(p.finished_at, p.created_at) < v_phase_cutoff;
  get diagnostics v_phase_deleted = row_count;

  select min(coalesce(p.finished_at, p.created_at))
  into v_oldest_phase
  from public.system_job_phases p;

  delete from public.system_job_runs r
  where r.status in ('succeeded', 'failed', 'skipped')
    and coalesce(r.finished_at, r.created_at) < v_job_cutoff;
  get diagnostics v_run_deleted = row_count;

  select min(coalesce(r.finished_at, r.created_at))
  into v_oldest_run
  from public.system_job_runs r;

  return jsonb_build_object(
    'status', 'succeeded',
    'referenceAt', p_reference_at,
    'durationMs', greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::bigint),
    'tables', jsonb_build_array(
      jsonb_build_object(
        'table', 'system_job_phases',
        'cutoff', v_phase_cutoff,
        'deletedRows', v_phase_deleted,
        'oldestRetainedAt', v_oldest_phase,
        'policy', 'terminal job phase detail, 1d'
      ),
      jsonb_build_object(
        'table', 'system_job_runs',
        'cutoff', v_job_cutoff,
        'deletedRows', v_run_deleted,
        'oldestRetainedAt', v_oldest_run,
        'policy', 'terminal job run summaries, 7d'
      )
    )
  );
end;
$function$;

revoke all on function public.qeo_run_job_telemetry_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_run_job_telemetry_cleanup(timestamptz) to service_role;

comment on function public.qeo_run_job_telemetry_cleanup(timestamptz) is
  'QEO-29 service-role-only cleanup: terminal system_job_phases 1d, terminal system_job_runs 7d; queued/running lifecycles preserved.';

commit;
