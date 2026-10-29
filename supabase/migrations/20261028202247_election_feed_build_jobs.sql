-- Durable, district-scoped work queue. Job rows contain only derived election
-- geography; raw user addresses never enter this table.
CREATE TABLE public.election_feed_build_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle integer NOT NULL CHECK (cycle = 2026),
  stage text NOT NULL CHECK (stage = 'general'),
  contest_type text NOT NULL CHECK (contest_type = 'regular'),
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  office text NOT NULL CHECK (office IN ('house','senate')),
  district integer,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','partial','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  retry_after timestamptz,
  progress jsonb NOT NULL DEFAULT '{"stages":{"candidates":"pending","websites":"pending","positions":"pending"}}',
  error_codes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(error_codes)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((office='house' AND district BETWEEN 0 AND 99 AND district IS NOT NULL)
    OR (office='senate' AND district IS NULL)),
  CHECK ((status='running') = (lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('queued','running')) = (finished_at IS NULL))
);
CREATE UNIQUE INDEX election_feed_build_scope
  ON public.election_feed_build_jobs(cycle,state,office,(COALESCE(district,-1)));
CREATE INDEX election_feed_build_claim
  ON public.election_feed_build_jobs(status,retry_after,requested_at)
  WHERE status IN ('queued','running','partial','failed');

ALTER TABLE public.election_feed_build_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.election_feed_build_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.election_feed_build_jobs TO service_role;
