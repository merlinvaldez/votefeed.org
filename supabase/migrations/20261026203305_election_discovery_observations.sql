-- Evidence can exist before a person identifier or race has been resolved.
CREATE TABLE public.election_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL CHECK (length(source_key)>0),
  system text NOT NULL CHECK (length(system)>0),
  requested_url text NOT NULL, final_url text NOT NULL,
  retrieved_at timestamptz NOT NULL, effective_at timestamptz,
  media_type text NOT NULL, content bytea NOT NULL,
  source_text text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  context_fingerprint text NOT NULL CHECK (context_fingerprint ~ '^[a-f0-9]{64}$'),
  context jsonb NOT NULL,
  UNIQUE(source_key,system,fingerprint,context_fingerprint)
);
CREATE TABLE public.election_discovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.election_source_documents(id),
  run_id uuid REFERENCES public.election_ingestion_runs(id),
  extractor text NOT NULL, model text, prompt_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('valid','partial','invalid','failed','needs-review')),
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.election_discovery_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.election_source_documents(id),
  record_key text NOT NULL CHECK (record_key ~ '^[a-f0-9]{64}$'),
  validation_key text NOT NULL CHECK (validation_key ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL,
  validation jsonb NOT NULL CHECK (validation->>'outcome' IN ('valid','invalid','needs-review')),
  attempt_id uuid NOT NULL REFERENCES public.election_discovery_attempts(id),
  UNIQUE(document_id,record_key,validation_key)
);
CREATE INDEX election_observation_document ON public.election_discovery_observations(document_id);
ALTER TABLE public.election_candidacies ADD CONSTRAINT election_candidacy_person_pair UNIQUE(id,candidate_id);
CREATE TABLE public.election_observation_resolutions (
  observation_id uuid PRIMARY KEY REFERENCES public.election_discovery_observations(id),
  candidate_id uuid NOT NULL REFERENCES public.election_candidates(id),
  candidacy_id uuid,
  FOREIGN KEY(candidacy_id,candidate_id) REFERENCES public.election_candidacies(id,candidate_id),
  method text NOT NULL CHECK (method IN ('fec-id','official-id','same-record','new-person','reviewed-evidence')),
  evidence jsonb NOT NULL CHECK (evidence ?& ARRAY['actor','url','checkedAt']),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX election_resolution_person ON public.election_observation_resolutions(candidate_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['election_source_documents','election_discovery_attempts',
    'election_discovery_observations','election_observation_resolutions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',table_name);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO service_role',table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_election_history()',table_name||'_immutable',table_name);
  END LOOP;
END $$;
