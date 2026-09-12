-- QEO-197: UpCloud owns canonical EOD scheduling at 15:01 ICT.
-- Preserve the legacy pg_cron definition as an inactive rollback path.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'qeoindex-eod-pipeline-1515-ict'
  limit 1;

  if v_jobid is not null then
    perform cron.alter_job(v_jobid, active := false);
  end if;
end
$$;
