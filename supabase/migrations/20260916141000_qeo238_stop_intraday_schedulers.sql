-- QEO-238 phase 1: permanently stop stock-chart intraday regeneration before
-- any Storage or PostgreSQL cleanup. Historical scheduler definitions remain in
-- prior migrations; this migration owns only the two retired chart jobs.

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'qeoindex-chart-intraday-maintenance-1450-ict'
  ) then
    perform cron.unschedule('qeoindex-chart-intraday-maintenance-1450-ict');
  end if;

  if exists (
    select 1 from cron.job
    where jobname = 'qeoindex-chart-archive-catchup-1645-ict'
  ) then
    perform cron.unschedule('qeoindex-chart-archive-catchup-1645-ict');
  end if;
end
$$;
