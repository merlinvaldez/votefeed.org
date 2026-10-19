-- Keep each user's delivery cursor separate by chamber and Congress.
CREATE TABLE public.user_vote_notification_progress (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chamber text NOT NULL CHECK (chamber IN ('House', 'Senate')),
  congress_number integer NOT NULL CHECK (congress_number > 0),
  last_notified_session_number integer,
  last_notified_roll_call_number integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chamber, congress_number),
  CHECK (
    (last_notified_session_number IS NULL) =
    (last_notified_roll_call_number IS NULL)
  )
);

ALTER TABLE public.user_vote_notification_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_vote_notification_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.user_vote_notification_progress TO service_role;

-- Preserve each user's existing House cursor in the new progress table.
INSERT INTO public.user_vote_notification_progress (
  user_id,
  chamber,
  congress_number,
  last_notified_session_number,
  last_notified_roll_call_number
)
SELECT
  id,
  'House',
  119,
  last_notified_session_number,
  last_notified_roll_call_number
FROM public.users
WHERE last_notified_session_number IS NOT NULL
  AND last_notified_roll_call_number IS NOT NULL
ON CONFLICT (user_id, chamber, congress_number) DO NOTHING;

-- Supabase pg_cron runs in UTC. Start at 10:30 UTC after the 09:00 UTC House
-- sync and the 10:15 UTC Senate sync.
DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'send-vote-notifications-0930-0955-utc',
      'send-vote-notifications-1000-utc'
    )
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'send-vote-notifications-daily-1030-utc',
    '30 10 * * *',
    $job$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'project_url'
        ) || '/functions/v1/send-vote-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'edge_function_service_jwt'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) AS request_id;
    $job$
  );
END
$$;
