-- Existing outbox rows and any still-running House-only writer use these
-- defaults. Updated writers provide the complete event identity explicitly.
ALTER TABLE public.vote_notification_outbox
  ADD COLUMN chamber text NOT NULL DEFAULT 'House',
  ADD COLUMN congress_number integer NOT NULL DEFAULT 119;

DROP INDEX IF EXISTS public.idx_vote_notification_outbox_sync_member_roll_call;

CREATE UNIQUE INDEX idx_vote_notification_outbox_sync_member_roll_call
  ON public.vote_notification_outbox
  (sync_run_id, member_id, chamber, congress_number, session_number, roll_call_number);
