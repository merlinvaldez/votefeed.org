-- UTC covers both Eastern offsets. The SQL and function guards keep actual
-- delivery at 05:30–06:25 America/New_York throughout daylight saving changes.
DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname LIKE 'send-vote-notifications%'
  LOOP
    PERFORM cron.alter_job(existing_job.jobid, active := false);
  END LOOP;

  PERFORM cron.schedule(
    'send-vote-notifications-morning-retry',
    '*/5 9-11 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')
          || '/functions/v1/send-vote-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' ||
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='edge_function_service_jwt')
        ),
        body := '{"mode":"scheduled"}'::jsonb,
        timeout_milliseconds := 100000
      ) AS request_id
      WHERE (now() AT TIME ZONE 'America/New_York')::time >= TIME '05:30'
        AND (now() AT TIME ZONE 'America/New_York')::time < TIME '06:26';
    $job$
  );
END
$$;
