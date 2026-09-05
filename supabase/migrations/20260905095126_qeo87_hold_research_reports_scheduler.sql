do $$
begin
  if exists (select 1 from cron.job where jobname = 'research-reports-daily-0705-ict') then
    perform cron.unschedule('research-reports-daily-0705-ict');
  end if;
end $$;
