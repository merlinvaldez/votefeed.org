-- Recovery policy approved October 22: old responses refer to the saved House
-- member and the latest recorded vote, matching the former feed selection.
-- Never infer another member or expand one response across multiple events.
WITH measures AS (
  SELECT b.id, min(m.congress_number) AS congress,
    CASE b.bill_type WHEN 'hr' THEN 'house-bill' WHEN 's' THEN 'senate-bill'
      WHEN 'hres' THEN 'house-resolution' WHEN 'sres' THEN 'senate-resolution'
      WHEN 'hjres' THEN 'house-joint-resolution' WHEN 'sjres' THEN 'senate-joint-resolution'
      WHEN 'hconres' THEN 'house-concurrent-resolution' WHEN 'sconres' THEN 'senate-concurrent-resolution' END AS measure,
    b.number
  FROM public.bills b JOIN public.member_voting_record m
    ON m.legislation_type=b.bill_type AND m.legislationnumber=b.number
  WHERE b.legislation_url IS NULL
  GROUP BY b.id
  HAVING count(DISTINCT m.congress_number)=1 AND min(m.congress_number)>0
)
UPDATE public.bills b SET legislation_url='https://www.congress.gov/bill/' ||
  measures.congress || CASE WHEN measures.congress % 100 BETWEEN 11 AND 13 THEN 'th'
    WHEN measures.congress % 10=1 THEN 'st' WHEN measures.congress % 10=2 THEN 'nd'
    WHEN measures.congress % 10=3 THEN 'rd' ELSE 'th' END || '-congress/' || measures.measure || '/' || measures.number
FROM measures WHERE b.id=measures.id AND measures.measure IS NOT NULL;

WITH recovered AS (
  SELECT i.id, (
    SELECT m.id FROM public.member_voting_record m
    WHERE m.member_id=i.rep_bioguide_id AND m.chamber='House'
      AND m.legislation_type=b.bill_type AND m.legislationnumber=b.number
      AND m.voted_on IS NOT NULL AND isfinite(m.voted_on)
      AND b.legislation_url ~ ('^https://www[.]congress[.]gov/bill/' || m.congress_number || '(st|nd|rd|th)-congress/')
    ORDER BY m.voted_on DESC,m.session_number DESC,m.roll_call_number DESC,m.id DESC LIMIT 1
  ) AS vote_id
  FROM public.interactions i JOIN public.bills b ON b.id=i.bill_id
  WHERE i.member_vote_id IS NULL
)
UPDATE public.interactions i SET member_vote_id=recovered.vote_id
FROM recovered WHERE i.id=recovered.id AND recovered.vote_id IS NOT NULL AND i.member_vote_id IS NULL;
