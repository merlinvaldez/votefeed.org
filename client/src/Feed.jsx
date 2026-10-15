import { useEffect, useEffectEvent, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";
import RepCard from "./RepCard";
import { summaryIdentity, hasSummaryText, summaryView, createSummaryRequests } from "./feedSummaries";
import { buildFeedUrl, adaptDelegationFeed, mergeFeedPage, createFeedRequests } from "./delegationFeedClient";
import { fetchDelegationAlignment } from "./alignmentRefresh";
import { billNavigation } from "./billDetailContext";
import { getVotePosition } from "./votePosition";
import { findVoteInteraction, isAnsweredVote, getCardResponseTargets, buildMemberStancePayload, getCardResponseState, buildCardStanceRequest, reconcileCardStanceResult } from "./voteInteractions";
import "./Feed.css";
import {
  Info,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  Clock3,
  Search,
  CheckCircle2,
  XCircle,
  ScrollText,
} from "lucide-react";

const getRepLastName = (fullName = "") => {
  const normalized = fullName.trim();
  if (!normalized) return "";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim();
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

const formatVotedOn = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatBillLabel = (type, number) => {
  const normalized = String(type || "hr").toLowerCase();
  const labels = {
    hr: "H.R.",
    hres: "H.Res.",
    hjres: "H.J.Res.",
    hconres: "H.Con.Res.",
    s: "S.",
    sres: "S.Res.",
    sjres: "S.J.Res.",
    sconres: "S.Con.Res.",
  };
  return `${labels[normalized] || normalized.toUpperCase()} ${number}`;
};

const formatLegislationType = (type) => {
  const normalized = String(type || "").toLowerCase();
  if (["hr", "s"].includes(normalized)) return "a bill";
  if (["hres", "sres"].includes(normalized)) return "a resolution";
  if (["hjres", "sjres"].includes(normalized)) return "a joint resolution";
  if (["hconres", "sconres"].includes(normalized)) {
    return "a concurrent resolution";
  }
  return "legislation";
};

const formatQuickSummary = (summary = "") => {
  const trimmed = String(summary)
    .replace(/^\s*to\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  if (!trimmed) return "summarize what this measure would do";
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
};

function Feed(props) {
  const PAGE_SIZE = 5;
  const [selectedChamber, setSelectedChamber] = useState("All Reps");
  const { token, authFetch } = useAuth();
  const isAuthed = Boolean(token);
  const location = useLocation();
  const navigate = useNavigate();
  const {
    selectedPolicyArea,
    setSelectedPolicyArea,
    setSidebarPolicyAreas,
    setSidebarTotalPolicyCount,
  } = useOutletContext();
  const guestBarRef = useRef(null);
  const guestHighlightTimeoutRef = useRef(null);
  const alignmentRequestRef = useRef(0);
  const stancePendingRef = useRef(new Set());
  const [stancePending, setStancePending] = useState({});
  const [alignmentError, setAlignmentError] = useState("");
  const [stanceError, setStanceError] = useState("");

  const [feedState, setFeedState] = useState(token ? null : location.state || props.state);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);

  const [interactions, setInteractions] = useState([]);
  const [userId, setUserId] = useState(null);
  const [savedLocation, setSavedLocation] = useState(null);
  const guestLocation = (location.state || props.state)?.district;
  const feedLocation = token ? savedLocation : guestLocation;
  const scopeKey = JSON.stringify([token ? userId : "guest", feedLocation?.state,
    feedLocation?.congressionalDistrict ?? feedLocation?.district, selectedPolicyArea, selectedChamber, location.key]);
  const [feedRequests] = useState(createFeedRequests);
  const isCurrentFeed = feedState?.scopeKey === scopeKey;
  const hasMore = isCurrentFeed && Boolean(feedState?.page?.hasMore);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef(null);
  const votes = useMemo(() => isCurrentFeed ? feedState?.votes ?? [] : [], [isCurrentFeed, feedState?.votes]);

  const [summaryRequests] = useState(createSummaryRequests);
  const [showOriginalByCard, setShowOriginalByCard] = useState({});
  const [aiSummaryByBill, setAiSummaryByBill] = useState({});
  const [aiLoadingByBill, setAiLoadingByBill] = useState({});
  const [aiErrorByBill, setAiErrorByBill] = useState({});
  const [mobilePolicySearch, setMobilePolicySearch] = useState("");
  const [isMobilePolicySearchOpen, setIsMobilePolicySearchOpen] =
    useState(false);
  const availablePolicyAreas = feedState?.policyAreas ?? [];
  const totalPolicyCount = feedState?.totalPolicyCount ?? 0;
  const normalizedMobilePolicySearch = mobilePolicySearch.trim().toLowerCase();
  const mobileVisiblePolicyAreas = availablePolicyAreas.filter((policyArea) =>
    policyArea.name.toLowerCase().includes(normalizedMobilePolicySearch),
  );

  useEffect(() => {
    setSidebarPolicyAreas(feedState?.policyAreas ?? []);
    setSidebarTotalPolicyCount(feedState?.totalPolicyCount ?? 0);
  }, [
    feedState,
    setSidebarPolicyAreas,
    setSidebarTotalPolicyCount,
    setSelectedPolicyArea,
  ]);

  useEffect(() => {
    return () => {
      setSidebarPolicyAreas([]);
      setSidebarTotalPolicyCount(0);
      setSelectedPolicyArea(null);
    };
  }, [
    setSidebarPolicyAreas,
    setSidebarTotalPolicyCount,
    setSelectedPolicyArea,
  ]);

  useEffect(() => {
    return () => {
      window.clearTimeout(guestHighlightTimeoutRef.current);
    };
  }, []);

  const promptGuestInteraction = () => {
    if (isAuthed) return false;
    guestBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setIsGuestBarHighlighted(false);
    window.clearTimeout(guestHighlightTimeoutRef.current);
    window.requestAnimationFrame(() => {
      setIsGuestBarHighlighted(true);
    });
    guestHighlightTimeoutRef.current = window.setTimeout(() => {
      setIsGuestBarHighlighted(false);
    }, 1400);
    return true;
  };

  const loadAiSummary = async (card, forceRetry = false) => {
    const billIdentity = summaryIdentity(card);
    if (!forceRetry && (hasSummaryText(card.simplifiedText) || hasSummaryText(aiSummaryByBill[billIdentity]) || aiErrorByBill[billIdentity])) return;
    if (!summaryRequests.begin(billIdentity)) return;
    setAiLoadingByBill(prev => ({ ...prev, [billIdentity]: true }));
    setAiErrorByBill(prev => ({ ...prev, [billIdentity]: null }));
    try {
      const params = new URLSearchParams({ congress: String(card.bill.congress) });
      const resp = await fetch(`${API_BASE}/bills/${card.bill.type}/${card.bill.number}/ai-summary?${params}`);
      if (!resp.ok) throw new Error("The simplified summary could not be loaded.");
      const data = await resp.json();
      if (!hasSummaryText(data.aiSummary)) throw new Error("The simplified summary is unavailable.");
      setAiSummaryByBill(prev => ({ ...prev, [billIdentity]: data.aiSummary }));
    } catch (err) {
      setAiErrorByBill(prev => ({ ...prev, [billIdentity]: err.message }));
    } finally {
      summaryRequests.finish(billIdentity);
      setAiLoadingByBill(prev => ({ ...prev, [billIdentity]: false }));
    }
  };

  const loadSummaryOnEntry = useEffectEvent(loadAiSummary);
  useEffect(() => {
    votes.forEach(vote => loadSummaryOnEntry(vote));
  }, [votes]);

  useEffect(() => {
    if (!token && !guestLocation?.state) navigate("/", { replace: true });
  }, [token, guestLocation?.state, navigate]);

  useEffect(() => {
    feedRequests.reset();
    setIsFetchingMore(false);
    setError("");
    setFeedState(null);
    if (!feedLocation?.state || (token && !userId)) return;
    const ticket = feedRequests.begin();
    setLoading(true);
    (async () => {
      try {
        const url = buildFeedUrl({ apiBase: API_BASE, isGuest: !token,
          district: feedLocation, pageSize: PAGE_SIZE, policyArea: selectedPolicyArea, chamber: selectedChamber });
        const resp = await (token ? authFetch(url, { signal: ticket.controller.signal })
          : fetch(url, { signal: ticket.controller.signal }));
        if (!resp.ok) throw new Error("Failed to load feed");
        const feed = adaptDelegationFeed(await resp.json());
        if (!feedRequests.current(ticket)) return;
        setFeedState({ ...feed, scopeKey, district: token ? null : feedLocation });
      } catch (err) {
        if (feedRequests.current(ticket)) setError(err.message || "Failed to load feed");
      } finally {
        if (feedRequests.current(ticket)) {
          setLoading(false);
          feedRequests.finish(ticket);
        }
      }
    })();
    return () => feedRequests.reset();
  }, [scopeKey, token, userId, feedLocation, selectedPolicyArea, selectedChamber, authFetch, feedRequests]);

  const loadMoreVotes = useEffectEvent(async () => {
    if (!isCurrentFeed || loading || !hasMore || !feedState.page.nextCursor) return;
    const ticket = feedRequests.begin();
    if (!ticket) return;
    const cursor = feedState.page.nextCursor;
    setIsFetchingMore(true);
    try {
      const url = buildFeedUrl({ apiBase: API_BASE, isGuest: !token,
        district: feedLocation, pageSize: PAGE_SIZE, cursor, policyArea: selectedPolicyArea, chamber: selectedChamber });
      const resp = await (token ? authFetch(url, { signal: ticket.controller.signal })
        : fetch(url, { signal: ticket.controller.signal }));
      if (!resp.ok) throw new Error("Failed to load more votes");
      const nextFeed = adaptDelegationFeed(await resp.json());
      if (!feedRequests.current(ticket)) return;
      setFeedState(prev => prev?.scopeKey === scopeKey
        ? mergeFeedPage(prev, nextFeed, cursor) : prev);
    } catch (err) {
      if (feedRequests.current(ticket)) setError(err.message || "Failed to load more votes");
    } finally {
      if (feedRequests.current(ticket)) {
        setIsFetchingMore(false);
        feedRequests.finish(ticket);
      }
    }
  });

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!token && !feedLocation?.state) return;
        if (!hasMore || isFetchingMore) return;
        if (loading) return;
        loadMoreVotes();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [
    token,
    feedLocation?.state,
    hasMore,
    isFetchingMore,
    loading,
    feedState?.page?.nextCursor,
    selectedPolicyArea,
  ]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const meResp = await authFetch(`${API_BASE}/users/me`);
        if (!meResp.ok) throw new Error("Failed to load user");
        const me = await meResp.json();
        if (!cancelled) {
          setUserId(me.id);
          setSavedLocation({ state: me.state, district: me.district ?? null });
        }

        const interactionsResp = await authFetch(
          `${API_BASE}/interactions/users/${me.id}`,
        );
        if (!interactionsResp.ok)
          throw new Error("Failed to load interactions");
        const data = await interactionsResp.json();
        if (!cancelled) setInteractions(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load interactions");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, authFetch, location.key]);

  const rep = feedState?.delegation ? feedState.delegation.houseMember : feedState?.rep;
  // Signed-in profiles take precedence over any guest navigation data.
  // Location remains available during loading and House vacancies. Preserve
  // both supported district shapes, including at-large district zero.
  const cardLocation = feedLocation ?? null;
  const alignmentForCard = isAuthed ? feedState?.alignment ?? null : null;

  const refreshAlignmentSummary = async () => {
    if (!token) return;
    const requestId = ++alignmentRequestRef.current;
    const policyArea = selectedPolicyArea;
    setAlignmentError("");
    try {
      const alignment = await fetchDelegationAlignment(authFetch, API_BASE, policyArea);
      if (requestId !== alignmentRequestRef.current) return;
      setFeedState(prev => prev?.scopeKey === scopeKey && (prev.selectedPolicyArea ?? null) === policyArea
        ? { ...prev, alignment } : prev);
    } catch (err) {
      if (requestId === alignmentRequestRef.current) setAlignmentError(err.message);
    }
  };

  const latestAlignmentRefresh = useRef(null);
  useEffect(() => {
    latestAlignmentRefresh.current = refreshAlignmentSummary;
  });

  // Navigation can restore cached feed data after an answer on BillPage.
  const refreshAlignmentOnEntry = useEffectEvent(refreshAlignmentSummary);
  useEffect(() => {
    refreshAlignmentOnEntry();
    return () => { alignmentRequestRef.current += 1; };
  }, [token, savedLocation?.state, savedLocation?.district, selectedPolicyArea, feedState?.scopeKey]);

  const handleStance = async (vote, stance) => {
    if (!isAuthed || !userId) {
      promptGuestInteraction();
      return;
    }

    const targets = getCardResponseTargets(vote);
    if (targets.length === 2) {
      let request;
      try { request = buildCardStanceRequest(vote, interactions, stance); }
      catch (err) { setStanceError(err.message); return; }
      const voteIds = targets.map(target => target.memberVoteId);
      if (voteIds.some(id => stancePendingRef.current.has(id))) return;
      voteIds.forEach(id => stancePendingRef.current.add(id));
      setStancePending(prev => ({ ...prev, ...Object.fromEntries(voteIds.map(id => [id, true])) }));
      setStanceError("");
      try {
        const resp = await authFetch(`${API_BASE}/interactions/stances/batch`, {
          method: "PUT", body: JSON.stringify(request),
        });
        if (!resp.ok) {
          const error = await resp.json().catch(() => null);
          throw new Error(error?.error || "Failed to save both member responses. Please try again.");
        }
        const result = await resp.json();
        // Validate outside the state updater so malformed responses reach the error handler.
        reconcileCardStanceResult([], request, result.interactions);
        setInteractions(prev => reconcileCardStanceResult(prev, request, result.interactions));
        await latestAlignmentRefresh.current?.();
      } catch (err) {
        setStanceError(err.message || "Failed to save both member responses");
      } finally {
        voteIds.forEach(id => stancePendingRef.current.delete(id));
        setStancePending(prev => ({ ...prev, ...Object.fromEntries(voteIds.map(id => [id, false])) }));
      }
      return;
    }
    if (targets.length !== 1) return;
    const target = targets[0];
    let payload;
    try { payload = buildMemberStancePayload(target, stance); } catch { return; }
    const memberVoteId = target.memberVoteId;
    if (!memberVoteId || stancePendingRef.current.has(memberVoteId)) return;
    stancePendingRef.current.add(memberVoteId);
    setStancePending(prev => ({ ...prev, [memberVoteId]: true }));
    setStanceError("");
    try {
      const existing = findVoteInteraction(interactions, target.billId, target.memberId, memberVoteId);
      if (isAnsweredVote(existing, memberVoteId) && existing.stance === stance) {
        const resp = await authFetch(
          `${API_BASE}/interactions/${existing.id}/stance`,
          { method: "PUT", body: JSON.stringify({ stance: null, member_vote_id: memberVoteId }) },
        );
        if (!resp.ok) throw new Error("Failed to clear stance");
        const cleared = await resp.json();
        setInteractions(prev => prev.map(i => i.id === cleared.id ? { ...i, ...cleared } : i));
        await latestAlignmentRefresh.current?.();
        return;
      }

      const resp = await authFetch(
        existing
          ? `${API_BASE}/interactions/${existing.id}/stance`
          : `${API_BASE}/interactions/addstance`,
        {
          method: existing ? "PUT" : "POST",
          body: JSON.stringify(
            existing
              ? { stance, member_vote_id: memberVoteId }
              : payload,
          ),
        },
      );
      if (!resp.ok) {
        const payload = await resp.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save stance");
      }
      const saved = await resp.json();

      setInteractions((prev) => {
        const withoutCurrent = prev.filter((i) => i.id !== saved.id);
        return [...withoutCurrent, saved];
      });
      await latestAlignmentRefresh.current?.();
    } catch (err) {
      setStanceError(err.message || "Failed to save stance");
    } finally {
      stancePendingRef.current.delete(memberVoteId);
      setStancePending(prev => ({ ...prev, [memberVoteId]: false }));
    }
  };

  if (loading || (!isCurrentFeed && !error)) return <div className="feed-loading">Loading feed...</div>;
  if (error) return <div className="error">{error}</div>;

  if (!feedState?.votes) {
    return <div>Missing feed data</div>;
  }
  const goToBill = (vote) => {
    navigate(billNavigation(vote, selectedChamber, token ? null : feedLocation), {
      state: { district: feedLocation, sourceCardId: vote.id, sourceChamber: selectedChamber },
    });
  };

  const handleCommentIntent = (vote) => {
    if (promptGuestInteraction()) return;
    goToBill(vote);
  };

  const handlePolicySelection = (policyArea) => {
    setSelectedPolicyArea(policyArea);
    setMobilePolicySearch("");
    setIsMobilePolicySearchOpen(false);
  };

  const toggleMobilePolicySearch = () => {
    setIsMobilePolicySearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setMobilePolicySearch("");
      }
      return next;
    });
  };

  return (
    <>
      {!isAuthed && (
        <div
          ref={guestBarRef}
          className={`guest-bar ${
            isGuestBarHighlighted ? "guest-bar-highlighted" : ""
          }`}
        >
          <div className="guest-left">
            <Info className="guest-icon" strokeWidth={1.75}></Info>
            <div>
              <div className="guest-title">Viewing as Guest</div>
              <div className="guest-sub">Your interactions won&apos;t be saved.</div>
            </div>
          </div>
          <button className="guest-cta" onClick={() => navigate("/signup")}>
            Sign Up / Sign In
          </button>
        </div>
      )}

      <RepCard
        chamber={selectedChamber}
        onChamberChange={setSelectedChamber}
        rep={rep}
        location={cardLocation}
        alignment={alignmentForCard}
        alignmentPolicyArea={feedState?.selectedPolicyArea ?? null}
        alignmentError={alignmentError}
      ></RepCard>

      <section className="feed-section">
        <h2 className="section-title">Legislative Feed</h2>
        <div className="mobile-policy-filter">
          <div className="mobile-policy-header">
            <div className="mobile-policy-current">
              <span className="mobile-policy-current-label">Policy Areas</span>
              <span className="mobile-policy-current-value">
                {selectedPolicyArea ?? "All"}
              </span>
            </div>
            <button
              type="button"
              className={`mobile-policy-toggle ${
                isMobilePolicySearchOpen ? "open" : ""
              }`}
              onClick={toggleMobilePolicySearch}
              aria-expanded={isMobilePolicySearchOpen}
              aria-controls="mobile-policy-search-panel"
              aria-label="Search policy areas"
              title="Search policy areas"
            >
              <Search size={16} />
            </button>
          </div>
          {isMobilePolicySearchOpen && (
            <div
              id="mobile-policy-search-panel"
              className="mobile-policy-search-panel"
            >
              <input
                id="mobile-policy-search"
                className="mobile-policy-search-input"
                type="search"
                placeholder="Search by policy area"
                value={mobilePolicySearch}
                onChange={(event) => setMobilePolicySearch(event.target.value)}
                autoFocus
              />
              <p className="mobile-policy-helper">
                Start typing to narrow the list.
              </p>
              <div className="mobile-policy-results">
                <div className="policy-list">
                  <button
                    type="button"
                    className={`policy-option ${
                      selectedPolicyArea === null ? "active" : ""
                    }`}
                    onClick={() => handlePolicySelection(null)}
                  >
                    <span>All</span>
                    <span className="policy-count">{totalPolicyCount}</span>
                  </button>
                  {mobileVisiblePolicyAreas.map((policyArea) => (
                    <button
                      key={policyArea.name}
                      type="button"
                      className={`policy-option ${
                        selectedPolicyArea === policyArea.name ? "active" : ""
                      }`}
                      onClick={() => handlePolicySelection(policyArea.name)}
                    >
                      <span>{policyArea.name}</span>
                      <span className="policy-count">{policyArea.count}</span>
                    </button>
                  ))}
                  {mobileVisiblePolicyAreas.length === 0 && (
                    <p className="policy-empty">No matching policy areas.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        {votes.length === 0 && <p>No eligible votes found for this delegation.</p>}

        {stanceError && <p className="error-text" role="alert">{stanceError}</p>}
        {votes.map((vote) => {
          const targets = getCardResponseTargets(vote);
          const target = targets.length === 1 ? targets[0] : null;
          const interaction = target ? findVoteInteraction(interactions, target.billId, target.memberId, target.memberVoteId) : null;
          const responseState = getCardResponseState(vote, interactions);
          const position = getVotePosition(vote.position ?? vote.vote, targets.length);
          const answeredStance = responseState.stance;
          const memberName = target?.name ?? (target?.memberId === rep?.bioguideid ? rep?.full_name : target?.memberId) ?? "";
          const repLastName = targets.length === 2
            ? targets.map(member => getRepLastName(member.name || member.memberId)).join(" and ")
            : getRepLastName(memberName);
          const memberTitle = targets.length === 2 ? "Sens." : target?.chamber === "Senate" ? "Sen." : "Rep.";
          const responseDisabled = (isAuthed && (targets.length === 0 || targets.some(member =>
            !member.memberId || !member.memberVoteId || Boolean(stancePending[member.memberVoteId]))));
          const billType = vote.legislation_type;
          const billIdentity = summaryIdentity(vote);
          const voteKey = vote.id;
          const billLabel = formatBillLabel(
            vote.legislation_type,
            vote.legislationnumber,
          );
          const showOriginal = Boolean(showOriginalByCard[voteKey]);
          const isLoadingAi = aiLoadingByBill[billIdentity];
          const aiText = hasSummaryText(aiSummaryByBill[billIdentity]) ? aiSummaryByBill[billIdentity]
            : hasSummaryText(vote.simplifiedText) ? vote.simplifiedText : null;
          const aiError = aiErrorByBill[billIdentity];
          const legislationType = formatLegislationType(billType);
          const voteClass = position.className;
          const view = summaryView({ showOriginal, officialHtml: vote.officialSummary, simplifiedText: aiText, loading: isLoadingAi, error: aiError });
          return (
            <div key={voteKey} className="leg-card">
              <div className="leg-top">
                <div className="leg-meta-row">
                  <button
                    type="button"
                    className="pill primary bill-link-pill"
                    onClick={() => goToBill(vote)}
                  >
                    {billLabel}
                  </button>
                  <span className="leg-date">
                    <Clock3 size={14}></Clock3>
                    {formatVotedOn(vote.voted_on)}
                  </span>
                </div>
                <button
                  type="button"
                  className={`summary-source-toggle${showOriginal ? " active" : ""}`}
                  onClick={() =>
                    setShowOriginalByCard((prev) => ({
                      ...prev,
                      [voteKey]: !prev[voteKey],
                    }))
                  }
                  aria-label={
                    showOriginal
                      ? "Show simplified summary"
                      : "This is an AI-generated summary. Toggle here to see the original from Congress.gov."
                  }
                  aria-pressed={showOriginal}
                  title={
                    showOriginal
                      ? "Show simplified summary"
                      : "This is an AI-generated summary. Toggle here to see the original from Congress.gov."
                  }
                >
                  <ScrollText size={24} strokeWidth={2} aria-hidden="true" />
                </button>
                {aiError && (
                  <div className="error-text" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {aiError}
                    <button 
                      type="button" 
                      onClick={() => loadAiSummary(vote, true)}
                      style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
              {view.mode === "official" && vote.officialSummary ? (
                <div
                  className="leg-body"
                  dangerouslySetInnerHTML={{ __html: vote.officialSummary }}
                />
              ) : view.mode !== "simplified" ? (
                <div className="leg-body" role="status">{view.message}</div>
              ) : (
                <div className="leg-body simple-vote-summary">
                  {memberTitle} {repLastName}{" "}
                  {position.verb}{position.label && (
                    <>{" "}
                      <span className={`pill inline-vote-pill ${voteClass}`}>
                        {position.label}
                      </span>
                    </>
                  )}{" "}
                  on {billLabel}, {legislationType} to{" "}
                  {formatQuickSummary(aiText)}.
                </div>
              )}
              <div className="leg-vote">
                {(() => {
                  let resultClass = "neutral";
                  if (vote.vote_result === "Passed") {
                    resultClass = "success";
                  } else if (vote.vote_result === "Failed") {
                    resultClass = "danger";
                  }
                  return (
                    <>
                      {vote.vote_result && (
                        <span className={`pill ${resultClass}`}>
                            {vote.vote_result === "Passed" ? (
                              <CheckCircle2 size={14} />
                            ) : vote.vote_result === "Failed" ? (
                              <XCircle size={14} />
                            ) : null}
                            {vote.vote_result}
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
              {view.showAction && <p className="response-status">
                {memberTitle} {repLastName} {position.verb}{position.label ? ` ${position.label}` : ""} on {billLabel}.
              </p>}
              {["mixed", "partial"].includes(responseState.status) && (
                <p className="response-status" role="status">
                  {responseState.status === "mixed" ? "Mixed responses: " : "Partial response: "}
                  {responseState.answers.map(answer =>
                    `${answer.name || answer.memberId}: ${answer.stance === "approve" ? "Agree" : answer.stance === "disapprove" ? "Disagree" : "Unanswered"}`
                  ).join("; ")}. Choosing a response applies to both Senators.
                </p>
              )}
              {responseState.invalid && <p className="error-text" role="alert">Some saved responses are invalid. Choose a response again or refresh.</p>}
              <div className="leg-actions">
                <button
                  type="button"
                  className={`ghost-btn ${
                    answeredStance === "approve" ? "active approve" : ""
                  }`}
                  onClick={() => handleStance(vote, "approve")}
                  disabled={responseDisabled}
                  aria-label={`Agree with ${memberTitle} ${repLastName}`}
                  aria-pressed={answeredStance === "approve"}
                  title={`Agree with ${memberTitle} ${repLastName}`}
                >
                  <ThumbsUp size={16} />
                  {answeredStance === "approve" && (
                    <span>I agree with {memberTitle} {repLastName}</span>
                  )}
                </button>

                <button
                  type="button"
                  className={`ghost-btn ${
                    answeredStance === "disapprove"
                      ? "active disapprove"
                      : ""
                  }`}
                  onClick={() => handleStance(vote, "disapprove")}
                  disabled={responseDisabled}
                  aria-label={`Disagree with ${memberTitle} ${repLastName}`}
                  aria-pressed={answeredStance === "disapprove"}
                  title={`Disagree with ${memberTitle} ${repLastName}`}
                >
                  <ThumbsDown size={16} />
                  {answeredStance === "disapprove" && (
                    <span>I disagree with {memberTitle} {repLastName}</span>
                  )}
                </button>

                <button
                  type="button"
                  className="comments"
                  disabled={targets.some(member => Boolean(stancePending[member.memberVoteId]))}
                  onClick={() => handleCommentIntent(vote)}
                  style={{ cursor: "pointer" }}
                >
                  <MessageCircle size={16} />
                  {interaction?.user_comment ? "1 Comment" : "0 Comments"}
                </button>
              </div>
            </div>
          );
        })}
        {hasMore && (
          <div ref={sentinelRef} className="feed-loading">
            <div>{isFetchingMore ? "Loading more..." : "Scroll for more"}</div>
          </div>
        )}
      </section>
    </>
  );
}

export default Feed;
