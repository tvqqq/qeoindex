begin;

do $$
begin
  if to_regprocedure('public.qeo_trigger_research_reports_daily()') is null then
    raise exception 'qeo_trigger_research_reports_daily() must exist before enabling the scheduler';
  end if;

  if exists (
    select 1
      from cron.job
     where jobname = 'research-reports-daily-0705-ict'
  ) then
    perform cron.unschedule('research-reports-daily-0705-ict');
  end if;
end $$;

select cron.schedule(
  'research-reports-daily-0705-ict',
  '5 0 * * *',
  $cron$
  select public.qeo_trigger_research_reports_daily();
  $cron$
);

commit;
