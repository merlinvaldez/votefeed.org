-- Additive, server-only persistence. Clerk identities are resolved by the server;
-- Supabase auth.uid() is not the integer users.id used by this application.
CREATE TABLE public.election_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  member_id text REFERENCES public.reps(bioguideid),
  match_status text NOT NULL DEFAULT 'unresolved' CHECK (match_status IN ('matched','unresolved','ambiguous','rejected')),
  match_evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.election_candidate_identities (
  system text NOT NULL CHECK (length(trim(system)) > 0),
  source_id text NOT NULL CHECK (length(trim(source_id)) > 0),
  candidate_id uuid NOT NULL REFERENCES public.election_candidates(id),
  evidence jsonb NOT NULL CHECK (evidence ?& ARRAY['url','checkedAt']),
  PRIMARY KEY (system, source_id)
);
CREATE INDEX election_identity_candidate ON public.election_candidate_identities(candidate_id);
CREATE TABLE public.election_races (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office text NOT NULL CHECK (office IN ('house','senate')),
  state text NOT NULL CHECK (state IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')),
  district integer, senate_seat integer,
  election_date date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('general','primary','runoff')),
  contest_type text NOT NULL CHECK (contest_type IN ('regular','special')),
  evidence jsonb NOT NULL CHECK (evidence ?& ARRAY['url','checkedAt']),
  CHECK ((office='house' AND district BETWEEN 0 AND 99 AND district IS NOT NULL AND senate_seat IS NULL)
    OR (office='senate' AND district IS NULL AND senate_seat IN (1,2,3) AND senate_seat IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (office,state,district,senate_seat,election_date,stage,contest_type)
);
CREATE INDEX election_race_lookup ON public.election_races(state,election_date,stage,contest_type,office);
CREATE TABLE public.election_candidacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.election_candidates(id),
  race_id uuid NOT NULL REFERENCES public.election_races(id), party text,
  eligibility text NOT NULL DEFAULT 'unknown' CHECK (eligibility IN ('unknown','filed','ballot-confirmed','withdrawn','disqualified')),
  eligibility_evidence jsonb NOT NULL DEFAULT '{}',
  availability text NOT NULL DEFAULT 'pending' CHECK (availability IN ('pending','available','no-positions','crawl-failed','extraction-failed')),
  last_attempt_at timestamptz, last_success_at timestamptz,
  failure_code text CHECK (failure_code IN ('crawl-failed','extraction-failed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id,race_id),
  CHECK (eligibility NOT IN ('ballot-confirmed','withdrawn','disqualified') OR
    (eligibility_evidence ?& ARRAY['system','url','checkedAt'] AND eligibility_evidence->>'system' LIKE 'state:%'))
);
CREATE INDEX election_candidacy_race ON public.election_candidacies(race_id,eligibility);
CREATE TABLE public.campaign_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidacy_id uuid NOT NULL REFERENCES public.election_candidacies(id),
  revision integer NOT NULL CHECK (revision > 0), proposed_url text,
  status text NOT NULL CHECK (status IN ('missing','proposed','verified','ambiguous','outdated','rejected')),
  approved_destinations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(approved_destinations)='array'),
  evidence jsonb NOT NULL DEFAULT '{}', checked_at timestamptz NOT NULL,
  review_after timestamptz, invalidation_reason text,
  is_current boolean NOT NULL DEFAULT true,
  UNIQUE(candidacy_id,revision), UNIQUE(id,candidacy_id),
  CHECK (status <> 'verified' OR (proposed_url IS NOT NULL AND jsonb_array_length(approved_destinations)>0
    AND review_after > checked_at AND review_after IS NOT NULL
    AND evidence ?& ARRAY['url','excerpt','method','verifierVersion']))
);
CREATE UNIQUE INDEX campaign_site_current ON public.campaign_sites(candidacy_id) WHERE is_current;
CREATE TABLE public.campaign_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidacy_id uuid NOT NULL REFERENCES public.election_candidacies(id),
  site_id uuid NOT NULL, requested_url text NOT NULL, final_url text NOT NULL,
  retrieved_at timestamptz NOT NULL, source_text text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'), verification_evidence jsonb NOT NULL,
  FOREIGN KEY (site_id,candidacy_id) REFERENCES public.campaign_sites(id,candidacy_id),
  UNIQUE(candidacy_id,final_url,fingerprint,site_id), UNIQUE(id,candidacy_id)
);
CREATE INDEX campaign_source_candidacy ON public.campaign_sources(candidacy_id,final_url);
CREATE TABLE public.campaign_fetch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid NOT NULL REFERENCES public.campaign_sources(id),
  fetched_at timestamptz NOT NULL, requested_url text NOT NULL
);
CREATE INDEX campaign_fetch_snapshot ON public.campaign_fetch_attempts(snapshot_id,fetched_at);
CREATE TABLE public.election_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stage text NOT NULL CHECK (stage IN ('discovery','crawl','extraction','publication')),
  scope jsonb NOT NULL CHECK (scope ?& ARRAY['cycle','stage','contestType','states','offices']),
  adapter text NOT NULL, adapter_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','partial','failed','unsupported')),
  counts jsonb NOT NULL DEFAULT '{}', coverage jsonb NOT NULL DEFAULT '[]',
  error_codes jsonb NOT NULL DEFAULT '[]',
  last_successful_run_id uuid REFERENCES public.election_ingestion_runs(id),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  CHECK ((status='pending') = (finished_at IS NULL))
);
CREATE TABLE public.campaign_processing_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidacy_id uuid NOT NULL REFERENCES public.election_candidacies(id),
  snapshot_id uuid, run_id uuid REFERENCES public.election_ingestion_runs(id),
  status text NOT NULL CHECK (status IN ('pending','complete','partial','crawl-failed','extraction-failed')),
  model text, prompt_version text, validation jsonb NOT NULL DEFAULT '{}',
  reconciliation jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(snapshot_id,candidacy_id) REFERENCES public.campaign_sources(id,candidacy_id)
);
CREATE INDEX campaign_attempt_candidacy ON public.campaign_processing_attempts(candidacy_id,created_at);
CREATE TABLE public.campaign_claims (
  id uuid PRIMARY KEY, candidacy_id uuid NOT NULL REFERENCES public.election_candidacies(id),
  UNIQUE(id,candidacy_id)
);
CREATE TABLE public.campaign_position_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidacy_id uuid NOT NULL,
  claim_id uuid NOT NULL, snapshot_id uuid NOT NULL,
  version_key text NOT NULL UNIQUE CHECK (version_key ~ '^[a-f0-9]{64}$'),
  claim_text text NOT NULL CHECK (length(trim(claim_text))>0),
  topic text NOT NULL CHECK (topic IN ('economy','healthcare','housing','education','environment','immigration','civil-rights','public-safety','foreign-policy','government','other')),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 500),
  excerpt text NOT NULL CHECK (length(trim(excerpt))>0),
  state text NOT NULL CHECK (state IN ('draft','published','superseded','removed','withheld')),
  model text NOT NULL CHECK (length(trim(model))>0), prompt_version text NOT NULL CHECK (length(trim(prompt_version))>0),
  validation jsonb NOT NULL CHECK (validation ?& ARRAY['outcome','validatorVersion','reasons']),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(claim_id,candidacy_id) REFERENCES public.campaign_claims(id,candidacy_id),
  FOREIGN KEY(snapshot_id,candidacy_id) REFERENCES public.campaign_sources(id,candidacy_id),
  CHECK (state <> 'published' OR COALESCE(validation->>'outcome'='valid',false))
);
CREATE UNIQUE INDEX campaign_claim_published ON public.campaign_position_versions(claim_id) WHERE state='published';
CREATE INDEX campaign_version_candidacy ON public.campaign_position_versions(candidacy_id,state);
CREATE INDEX campaign_version_source ON public.campaign_position_versions(snapshot_id);
CREATE TABLE public.campaign_position_evidence (
  position_version_id uuid NOT NULL REFERENCES public.campaign_position_versions(id),
  snapshot_id uuid NOT NULL REFERENCES public.campaign_sources(id),
  attempt_id uuid NOT NULL REFERENCES public.campaign_processing_attempts(id),
  presentation jsonb NOT NULL, PRIMARY KEY(position_version_id,snapshot_id,attempt_id)
);
CREATE TABLE public.election_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  position_version_id uuid NOT NULL REFERENCES public.campaign_position_versions(id),
  stance text CHECK (stance IN ('approve','disapprove')), private_comment text CHECK (length(private_comment)<=10000),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,position_version_id)
);
CREATE INDEX election_interaction_version ON public.election_interactions(position_version_id);
CREATE TABLE public.election_geography_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  district integer CHECK (district BETWEEN 0 AND 99),
  cycle integer NOT NULL, boundary_version text NOT NULL, source_url text NOT NULL,
  checked_at timestamptz NOT NULL, status text NOT NULL CHECK (status IN ('verified','unresolved')),
  CHECK (status <> 'verified' OR district IS NOT NULL)
);
ALTER TABLE public.users ADD COLUMN election_geography_evidence_id uuid
  REFERENCES public.election_geography_evidence(id) ON DELETE SET NULL;

-- Prevent accidental rewriting of evidence or wording already answered by a user.
CREATE FUNCTION public.protect_election_history() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Election history is immutable'; END IF;
  IF TG_TABLE_NAME='campaign_position_versions' THEN
    IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN
      RAISE EXCEPTION 'Position wording and evidence are immutable'; END IF;
  ELSIF TG_TABLE_NAME='campaign_sites' THEN
    IF (to_jsonb(NEW)-'is_current') IS DISTINCT FROM (to_jsonb(OLD)-'is_current') THEN
      RAISE EXCEPTION 'Site verification revisions are immutable'; END IF;
  ELSE RAISE EXCEPTION 'Source snapshots are immutable'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_election_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER campaign_source_immutable BEFORE UPDATE OR DELETE ON public.campaign_sources FOR EACH ROW EXECUTE FUNCTION public.protect_election_history();
CREATE TRIGGER campaign_version_immutable BEFORE UPDATE OR DELETE ON public.campaign_position_versions FOR EACH ROW EXECUTE FUNCTION public.protect_election_history();
CREATE TRIGGER campaign_site_immutable BEFORE UPDATE OR DELETE ON public.campaign_sites FOR EACH ROW EXECUTE FUNCTION public.protect_election_history();

CREATE FUNCTION public.validate_campaign_position() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE captured text;
BEGIN
  SELECT source_text INTO captured FROM public.campaign_sources WHERE id=NEW.snapshot_id AND candidacy_id=NEW.candidacy_id;
  IF captured IS NULL OR position(NEW.excerpt IN captured)=0 THEN RAISE EXCEPTION 'Supporting excerpt is absent from source'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_campaign_position() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER campaign_version_evidence BEFORE INSERT ON public.campaign_position_versions FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_position();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['election_candidates','election_candidate_identities','election_races','election_candidacies',
    'campaign_sites','campaign_sources','election_ingestion_runs','campaign_processing_attempts','campaign_claims',
    'campaign_position_versions','campaign_position_evidence','election_interactions','election_geography_evidence','campaign_fetch_attempts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',table_name);
  END LOOP;
END $$;
