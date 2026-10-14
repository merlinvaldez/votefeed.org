-- Server-only durable snapshots; browser roles must not read signing keys.
CREATE TABLE public.legislative_feed_snapshots (
  id uuid PRIMARY KEY,
  signing_key text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX legislative_feed_snapshots_expiry
  ON public.legislative_feed_snapshots(expires_at);
ALTER TABLE public.legislative_feed_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legislative_feed_snapshots FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.legislative_feed_snapshots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.legislative_feed_snapshots FROM authenticated;
  END IF;
END $$;
