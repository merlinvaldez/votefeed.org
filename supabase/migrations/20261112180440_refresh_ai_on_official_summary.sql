-- All ingestion paths must retire title-based/stale AI when official text changes.
ALTER TABLE public.bills ADD COLUMN ai_summary_needs_refresh boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.invalidate_bill_ai_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ai_summary_needs_refresh := nullif(btrim(NEW.summary), '') IS NOT NULL;
    IF NEW.ai_summary_needs_refresh THEN NEW.aisummary := NULL; END IF;
  ELSIF NEW.summary IS DISTINCT FROM OLD.summary THEN
    NEW.aisummary := NULL;
    NEW.ai_summary_needs_refresh := nullif(btrim(NEW.summary), '') IS NOT NULL;
  ELSIF NEW.aisummary IS DISTINCT FROM OLD.aisummary AND nullif(btrim(NEW.aisummary), '') IS NOT NULL THEN
    NEW.ai_summary_needs_refresh := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_bill_ai_summary_on_publication
BEFORE INSERT OR UPDATE OF summary, aisummary ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.invalidate_bill_ai_summary();
