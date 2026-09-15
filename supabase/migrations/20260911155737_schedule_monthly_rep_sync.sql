select cron.schedule(
  'sync-reps-monthly',
  '0 8 1 * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-reps',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_jwt')
      ),
      body := jsonb_build_object('source', 'monthly-cron'),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);
