ALTER TABLE public.interactions
ADD COLUMN member_vote_id integer
REFERENCES public.member_voting_record(id) ON DELETE SET NULL;

CREATE INDEX idx_interactions_user_member_vote
ON public.interactions(user_id, member_vote_id)
WHERE member_vote_id IS NOT NULL;
