-- Clearing a response must preserve the interaction and its comments.
ALTER TABLE public.interactions ALTER COLUMN stance DROP NOT NULL;
