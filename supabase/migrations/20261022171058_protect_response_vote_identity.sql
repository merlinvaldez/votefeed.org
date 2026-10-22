-- Fail instead of silently orphaning an answer if its recorded vote is deleted.
ALTER TABLE public.interactions DROP CONSTRAINT interactions_member_vote_id_fkey;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_member_vote_id_fkey
  FOREIGN KEY (member_vote_id) REFERENCES public.member_voting_record(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX interactions_user_bill_member_event_unique
  ON public.interactions(user_id,bill_id,rep_bioguide_id,member_vote_id)
  WHERE member_vote_id IS NOT NULL;

-- NOT VALID preserves any unresolved historical rows, while rejecting new
-- unlinked answers and requiring an explicit repair before editing old ones.
ALTER TABLE public.interactions ADD CONSTRAINT interactions_recorded_vote_required
  CHECK (member_vote_id IS NOT NULL) NOT VALID;
