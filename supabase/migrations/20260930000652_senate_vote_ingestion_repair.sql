-- Roll-call numbers restart in each chamber and each Congress.
ALTER TABLE public.roll_call_summaries
  ADD COLUMN congress_number integer NOT NULL DEFAULT 119,
  ADD COLUMN vote_title text,
  ADD COLUMN vote_question text,
  ADD COLUMN source_url text;

ALTER TABLE public.member_voting_record
  ADD COLUMN congress_number integer NOT NULL DEFAULT 119;

-- The old member index was still present in development and prevents
-- House and Senate records with the same member/session/roll number coexisting.
DROP INDEX IF EXISTS public.member_voting_record_member_roll_call_uidx;
DROP INDEX IF EXISTS public.idx_member_voting_record_member_roll_call;
DROP INDEX IF EXISTS public.idx_member_voting_record_member_chamber_roll_call;
DROP INDEX IF EXISTS public.idx_roll_call_summaries_chamber_session_roll_call;
DROP INDEX IF EXISTS public.idx_roll_call_summaries_session_roll_call;

CREATE UNIQUE INDEX idx_member_voting_record_vote_identity
  ON public.member_voting_record
  (member_id, chamber, congress_number, session_number, roll_call_number);

CREATE UNIQUE INDEX idx_roll_call_summaries_vote_identity
  ON public.roll_call_summaries
  (chamber, congress_number, session_number, roll_call_number);

-- This marker is written only after the summary and every member position
-- have been saved. A failed run can safely retry an incomplete roll call.
CREATE TABLE public.senate_vote_ingestion (
  congress_number integer NOT NULL,
  session_number integer NOT NULL,
  roll_call_number integer NOT NULL,
  member_count integer NOT NULL CHECK (member_count > 0),
  source_modified_at timestamptz,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (congress_number, session_number, roll_call_number)
);

ALTER TABLE public.senate_vote_ingestion ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.senate_vote_ingestion TO service_role;
