import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./authContext";
import { API_BASE } from "./constants";
import { billFolderTabs, initialBillFolder, billDetailUrl } from "./billDetailContext";
import BillDetailPanel from "./BillPage";
import { hasSummaryText } from "./feedSummaries";

export default function BillPageRoute() {
  const { billType, billNumber } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { token, authFetch } = useAuth();
  const params = new URLSearchParams(location.search);
  const congress = params.get("congress");
  const cardId = params.get("cardId") ?? location.state?.sourceCardId;
  const state = params.get("state") ?? location.state?.district?.state;
  const district = params.get("district") ?? location.state?.district?.congressionalDistrict ?? location.state?.district?.district;
  const scope = JSON.stringify([token, billType, billNumber, congress, cardId, state, district]);
  const [loaded, setLoaded] = useState(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [summaryPreference, setSummaryPreference] = useState(null);
  const [summaryResult, setSummaryResult] = useState(null);
  const summaryScope = JSON.stringify([billType, billNumber, congress]);
  const showOriginal = summaryPreference?.scope === summaryScope ? summaryPreference.showOriginal : true;
  const setShowOriginal = value => setSummaryPreference({ scope: summaryScope, showOriginal: value });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        if (!token && (!state || district == null)) throw new Error("Enter your address on the feed to see your delegation's recorded votes.");
        let resolvedCongress = congress;
        if (!resolvedCongress) {
          // Legacy direct links can recover measure identity, but never a member
          // action from a shared House representative or a bill number alone.
          const resp = await fetch(`${API_BASE}/bills/${billType}/${billNumber}`, { signal: controller.signal });
          if (!resp.ok) throw new Error("Bill not found");
          const bill = await resp.json();
          resolvedCongress = bill.legislation_url?.match(/^https:\/\/www\.congress\.gov\/bill\/(\d+)(?:st|nd|rd|th)-congress\//)?.[1];
          if (!resolvedCongress) throw new Error("This bill's Congress could not be verified. Reopen it from the feed.");
        }
        const url = billDetailUrl({ apiBase: API_BASE, authenticated: Boolean(token), billType, billNumber,
          congress: resolvedCongress, location: { state, district }, cardId });
        const resp = await (token ? authFetch(url, { signal: controller.signal }) : fetch(url, { signal: controller.signal }));
        const detail = await resp.json();
        if (!resp.ok) throw new Error(detail.error || "Bill votes could not be loaded");
        if (!controller.signal.aborted) setLoaded({ scope, detail });
      } catch (err) {
        if (!controller.signal.aborted) setLoaded({ scope, error: err.message });
      }
    })();
    return () => controller.abort();
  }, [scope, token, billType, billNumber, congress, cardId, state, district, authFetch, retry]);
  const detail = loaded?.scope === scope ? loaded.detail : null;
  const folders = useMemo(() => detail ? billFolderTabs(detail) : [], [detail]);
  const currentSummaryResult = summaryResult?.scope === summaryScope ? summaryResult : null;
  const aiSummary = [currentSummaryResult?.summary, detail?.bill?.aisummary].find(hasSummaryText) || "";
  const aiError = currentSummaryResult?.error || "";
  const aiLoading = Boolean(detail && !showOriginal && !aiSummary && !aiError);

  useEffect(() => {
    if (!detail || showOriginal || aiSummary || aiError) return;

    let cancelled = false;
    (async () => {
      try {
        const congressNumber = detail.cards[0]?.event?.congress ??
          Number(detail.bill.legislation_url?.match(/bill\/(\d+)/)?.[1]);
        if (!Number.isFinite(Number(congressNumber))) {
          throw new Error("Simplified summary unavailable");
        }
        const resp = await fetch(
          `${API_BASE}/bills/${billType}/${billNumber}/ai-summary?congress=${congressNumber}`,
        );
        if (!resp.ok) throw new Error("Simplified summary unavailable");
        const data = await resp.json();
        if (!hasSummaryText(data.aiSummary)) {
          throw new Error("Simplified summary unavailable");
        }
        if (!cancelled) {
          setSummaryResult({ scope: summaryScope, summary: data.aiSummary, error: "" });
        }
      } catch {
        if (!cancelled) {
          setSummaryResult({
            scope: summaryScope,
            summary: "",
            error: "Simplified summary unavailable. Showing the official summary.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail, showOriginal, aiSummary, aiError, summaryScope, billType, billNumber]);

  if (loaded?.scope === scope && loaded.error) return <div role="alert">
    <p>{loaded.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button> <Link to="/">Find your delegation</Link>
  </div>;
  if (!detail) return <p role="status">Loading bill and recorded votes…</p>;
  const requested = params.get("folder");
  const selected = folders.some(folder => folder.id === requested) ? requested
    : initialBillFolder(folders, { chamber: params.get("chamber") ?? location.state?.sourceChamber, cardId });
  const selectFolder = id => {
    if (busy) return;
    const query = new URLSearchParams(location.search);
    query.set("folder", id);
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true, state: location.state });
  };
  // Keep panels mounted so switching folders preserves unsaved comment text.
  // Inactive panels render nothing and do not load or generate content.
  return <>
    {detail.warnings?.map(warning => <p key={warning.code} role="status">{warning.message}</p>)}
    {folders.map(folder => <BillDetailPanel key={`${scope}:${folder.id}`} detail={detail} folder={folder}
      active={folder.id === selected} folders={folders} selectedFolder={selected}
      showOriginal={showOriginal} setShowOriginal={setShowOriginal}
      aiSummary={aiSummary} aiLoading={aiLoading} aiError={aiError}
      onRetrySummary={() => setSummaryResult(null)}
      onFolderChange={selectFolder} onBusy={setBusy} />)}
  </>;
}
