-- A shared Senate vote can have a separate comment in each district.
CREATE UNIQUE INDEX bill_comments_interaction_district_key
ON public.bill_comments (interaction_id, LOWER(BTRIM(district_state)), district_number);

ALTER TABLE public.bill_comments DROP CONSTRAINT bill_comments_interaction_id_key;
