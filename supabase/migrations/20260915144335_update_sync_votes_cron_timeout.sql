select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'sync-votes-daily'
  ),
  command := $cron$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-votes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
  $cron$
);
