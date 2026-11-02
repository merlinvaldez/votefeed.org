ALTER TABLE public.election_candidates
  ADD COLUMN image_url text,
  ADD COLUMN image_source text,
  ADD COLUMN image_checked_at timestamptz,
  ADD COLUMN image_expires_at timestamptz,
  ADD COLUMN image_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT election_candidate_image_source_check
    CHECK (image_source IS NULL OR image_source IN ('google-civic','reps:official','campaign-site')),
  ADD CONSTRAINT election_candidate_image_metadata_check
    CHECK (image_url IS NULL OR (image_source IS NOT NULL AND image_checked_at IS NOT NULL)),
  ADD CONSTRAINT election_candidate_google_image_expiry_check
    CHECK (image_source IS DISTINCT FROM 'google-civic' OR
      (image_url IS NULL OR (image_expires_at IS NOT NULL AND image_expires_at <= image_checked_at + interval '24 hours')));

ALTER TABLE public.election_candidacies
  DROP CONSTRAINT election_candidacies_check,
  ADD CONSTRAINT election_candidacies_check CHECK (
    eligibility NOT IN ('ballot-confirmed','withdrawn','disqualified') OR
    (eligibility_evidence ?& ARRAY['system','url','checkedAt'] AND
      (eligibility_evidence->>'system' LIKE 'state:%' OR
        (eligibility='ballot-confirmed' AND eligibility_evidence->>'system'='google-civic' AND
          eligibility_evidence ?& ARRAY['expiresAt','previousEligibility','previousEvidence'])))
  );

CREATE OR REPLACE FUNCTION public.expire_google_civic_candidate_data()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.election_candidacies
  SET eligibility = CASE
        WHEN eligibility_evidence->>'previousEligibility' IN ('unknown','filed')
          THEN eligibility_evidence->>'previousEligibility'
        ELSE 'unknown'
      END,
      eligibility_evidence = COALESCE(eligibility_evidence->'previousEvidence','{}'::jsonb),
      updated_at = now()
  WHERE eligibility='ballot-confirmed'
    AND eligibility_evidence->>'system'='google-civic'
    AND NULLIF(eligibility_evidence->>'expiresAt','')::timestamptz <= now();

  UPDATE public.election_candidates
  SET image_url=NULL,image_source=NULL,image_checked_at=NULL,image_expires_at=NULL,image_evidence='{}'::jsonb,
      updated_at=now()
  WHERE image_source='google-civic' AND image_expires_at<=now();
END;
$$;

REVOKE ALL ON FUNCTION public.expire_google_civic_candidate_data() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE job record;
BEGIN
  FOR job IN SELECT jobid FROM cron.job WHERE jobname='expire-google-civic-candidate-data' LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
  PERFORM cron.schedule('expire-google-civic-candidate-data','*/15 * * * *',
    'SELECT public.expire_google_civic_candidate_data();');
END;
$$;
