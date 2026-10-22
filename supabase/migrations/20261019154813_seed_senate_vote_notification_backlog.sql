-- Queue only Senate votes after October 22, 2026 in America/New_York.
-- This is idempotent across runs and leaves older or incomplete votes alone.
WITH notification_run AS (
  SELECT gen_random_uuid() AS sync_run_id
),
eligible_votes AS (
  SELECT
    m.member_id,
    m.congress_number,
    m.session_number,
    m.roll_call_number,
    m.legislation_type,
    m.legislationnumber AS legislation_number,
    m.voted_on,
    m.vote
  FROM public.member_voting_record AS m
  JOIN public.senate_vote_ingestion AS completed
    ON completed.congress_number = m.congress_number
   AND completed.session_number = m.session_number
   AND completed.roll_call_number = m.roll_call_number
  JOIN public.roll_call_summaries AS summary
    ON summary.chamber = 'Senate'
   AND summary.congress_number = m.congress_number
   AND summary.session_number = m.session_number
   AND summary.roll_call_number = m.roll_call_number
  WHERE m.chamber = 'Senate'
    AND m.congress_number = 119
    AND m.voted_on >= TIMESTAMPTZ '2026-10-23 00:00:00 America/New_York'
    AND m.legislation_type IS NOT NULL
    AND m.legislationnumber IS NOT NULL
)
INSERT INTO public.vote_notification_outbox (
  sync_run_id,
  member_id,
  chamber,
  congress_number,
  legislation_type,
  legislation_number,
  session_number,
  roll_call_number,
  voted_on,
  vote
)
SELECT
  notification_run.sync_run_id,
  eligible_votes.member_id,
  'Senate',
  eligible_votes.congress_number,
  eligible_votes.legislation_type,
  eligible_votes.legislation_number,
  eligible_votes.session_number,
  eligible_votes.roll_call_number,
  eligible_votes.voted_on,
  eligible_votes.vote
FROM eligible_votes
CROSS JOIN notification_run
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vote_notification_outbox AS existing
  WHERE existing.member_id = eligible_votes.member_id
    AND existing.chamber = 'Senate'
    AND existing.congress_number = eligible_votes.congress_number
    AND existing.session_number = eligible_votes.session_number
    AND existing.roll_call_number = eligible_votes.roll_call_number
);
