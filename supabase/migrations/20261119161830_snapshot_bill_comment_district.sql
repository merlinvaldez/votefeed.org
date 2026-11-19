ALTER TABLE public.bill_comments
  ADD COLUMN district_state text,
  ADD COLUMN district_number integer;

-- Older comments have no saved author location. Seed them from the current
-- profile once so later profile updates cannot move those comments.
UPDATE public.bill_comments AS comment
SET district_state = author.state,
    district_number = author.district
FROM public.users AS author
WHERE author.id = comment.user_id;
