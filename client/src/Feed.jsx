import { useEffect, useEffectEvent, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "./authContext";
import { API_BASE } from "./constants";
import RepCard from "./RepCard";
import LegislativeVoteCard from "./LegislativeVoteCard";
import ElectionsPanel from "./elections/ElectionsPanel";
import { summaryIdentity, hasSummaryText, createSummaryRequests } from "./feedSummaries";
import { buildFeedUrl, adaptDelegationFeed, mergeFeedPage, createFeedRequests } from "./delegationFeedClient";
import { fetchDelegationAlignment } from "./alignmentRefresh";
import { billNavigation } from "./billDetailContext";
import { findVoteInteraction, isAnsweredVote, getCardResponseTargets, buildMemberStancePayload, buildCardStanceRequest, reconcileCardStanceResult } from "./voteInteractions";
import "./Feed.css";
import {
  Info,
  Search,
  Users,
  Building2,
  Landmark,
  Vote,
} from "lucide-react";

const FEED_VIEW_TABS = [
  { value: "All Reps", label: "All Reps", icon: <Users size={22} aria-hidden="true" /> },
  { value: "House", label: "House of Representatives", shortLabel: "House", icon: <Building2 size={22} aria-hidden="true" /> },
  { value: "Senate", label: "Senate", icon: <Landmark size={22} aria-hidden="true" /> },
  { value: "Elections", label: "Elections", icon: <Vote size={22} aria-hidden="true" /> },
];

function FeedViewTabs({ activePanel, selectedChamber, onSelect }) {
  const selectedValue = activePanel === "elections" ? "Elections" : selectedChamber;

  function handleKeyDown(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % FEED_VIEW_TABS.length;
    if (event.key === "ArrowLeft") next = (index + FEED_VIEW_TABS.length - 1) % FEED_VIEW_TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = FEED_VIEW_TABS.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    onSelect(FEED_VIEW_TABS[next].value);
    event.currentTarget.parentElement.children[next].focus();
  }

  return (
    <div className="feed-view-tabs" role="tablist" aria-label="Feed sections">
      {FEED_VIEW_TABS.map(({ value, label, shortLabel, icon }, index) => {
        const isSelected = selectedValue === value;
        const id = `feed-view-tab-${value.toLowerCase().replace(/\s+/g, "-")}`;
        return (
          <button key={value} type="button" role="tab" id={id}
            aria-controls={value === "Elections" ? "elections-feed-panel" : "legislative-feed-panel"}
            aria-selected={isSelected} tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(value)} onKeyDown={event => handleKeyDown(event, index)}>
            {icon}<span className={shortLabel ? "feed-tab-full" : undefined}>{label}</span>
            {shortLabel && <span className="feed-tab-short">{shortLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Feed(props) {
  const PAGE_SIZE = 5;
  const [selectedChamber, setSelectedChamber] = useState("All Reps");
  const { token, authFetch } = useAuth();
  const isAuthed = Boolean(token);
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activePanel,
    setActivePanel,
    selectedPolicyArea,
    setSelectedPolicyArea,
    setPanelPolicyData,
    setPanelScopeKey,
  } = useOutletContext();
  const guestBarRef = useRef(null);
  const guestHighlightTimeoutRef = useRef(null);
  const alignmentRequestRef = useRef(0);
  const stancePendingRef = useRef(new Set());
  const [stancePending, setStancePending] = useState({});
  const [alignmentError, setAlignmentError] = useState("");
  const [stanceError, setStanceError] = useState("");

  const handleFeedViewSelect = (value) => {
    if (value === "Elections") {
      setActivePanel("elections");
      return;
    }
    setSelectedChamber(value);
    setActivePanel("legislative");
  };

  const [feedState, setFeedState] = useState(token ? null : location.state || props.state);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);

  const [interactions, setInteractions] = useState([]);
  const [userId, setUserId] = useState(null);
  const [savedLocation, setSavedLocation] = useState(null);
  const guestLocation = (location.state || props.state)?.district;
  const feedLocation = token ? savedLocation : guestLocation;
  // This key invalidates election-view state when the existing viewer/address
  // context changes. The representative district is only part of this local
  // reset identity; it is never sent as election geography.
  const electionContextKey = JSON.stringify([
    token ? userId ?? "signed-in-pending" : "guest",
    feedLocation?.state ?? null,
    feedLocation?.congressionalDistrict ?? feedLocation?.district ?? null,
    token ? feedLocation?.electionGeographyEvidenceId ?? null : null,
    location.key,
  ]);
  const delegationScope = JSON.stringify([token ? userId : "guest", feedLocation?.state,
    feedLocation?.congressionalDistrict ?? feedLocation?.district, location.key]);
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
  const availablePolicyAreas = isCurrentFeed ? feedState?.policyAreas ?? [] : [];
  const totalPolicyCount = isCurrentFeed ? feedState?.totalPolicyCount ?? 0 : 0;
  const normalizedMobilePolicySearch = mobilePolicySearch.trim().toLowerCase();
  const mobileVisiblePolicyAreas = availablePolicyAreas.filter((policyArea) =>
    policyArea.name.toLowerCase().includes(normalizedMobilePolicySearch),
  );

  useEffect(() => {
    setPanelPolicyData("legislative", {
      policyAreas: isCurrentFeed ? feedState?.policyAreas ?? [] : [],
      totalPolicyCount: isCurrentFeed ? feedState?.totalPolicyCount ?? 0 : 0,
    });
  }, [feedState, isCurrentFeed, setPanelPolicyData]);

  useEffect(() => {
    setPanelScopeKey("legislative", electionContextKey);
    setPanelScopeKey("elections", electionContextKey);
    setMobilePolicySearch("");
    setIsMobilePolicySearchOpen(false);
  }, [electionContextKey, setPanelScopeKey]);

  useEffect(() => {
    return () => {
      setPanelPolicyData("legislative", { policyAreas: [], totalPolicyCount: 0 });
      setSelectedPolicyArea(null);
    };
  }, [
    setPanelPolicyData,
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
        setFeedState({ ...feed, scopeKey, delegationScope, district: token ? null : feedLocation });
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
  }, [scopeKey, delegationScope, token, userId, feedLocation, selectedPolicyArea, selectedChamber, authFetch, feedRequests]);

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
          setSavedLocation({
            state: me.state,
            district: me.district ?? null,
            electionGeographyEvidenceId: me.election_geography_evidence_id ?? null,
          });
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

  const sameDelegation = feedState?.delegationScope === delegationScope;
  const feedPending = loading || (!isCurrentFeed && !error);
  const goToBill = (vote, discussion = false) => {
    navigate(billNavigation(vote, selectedChamber, token ? null : feedLocation) + (discussion ? "#public-comments" : ""), {
      state: { district: feedLocation, sourceCardId: vote.id, sourceChamber: selectedChamber },
    });
  };

  const handleCommentIntent = (vote) => {
    if (promptGuestInteraction()) return;
    goToBill(vote, true);
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

  const guestBar = !isAuthed && (
    <div
      ref={guestBarRef}
      className={`guest-bar ${isGuestBarHighlighted ? "guest-bar-highlighted" : ""}`}
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
  );

  const feedViewTabs = (
    <FeedViewTabs activePanel={activePanel} selectedChamber={selectedChamber}
      onSelect={handleFeedViewSelect} />
  );
  const electionsPanel = (
    <ElectionsPanel key={electionContextKey} viewer={isAuthed ? "signed-in" : "guest"}
      location={feedLocation}
      authFetch={authFetch}
      onGuestResponseAttempt={promptGuestInteraction}
      hidden={activePanel !== "elections"} />
  );

  if (activePanel === "elections") {
    return <>
      {guestBar}
      {feedViewTabs}
      {electionsPanel}
    </>;
  }

  const legislativeTabId = `feed-view-tab-${selectedChamber.toLowerCase().replace(/\s+/g, "-")}`;
  if (feedPending && !sameDelegation) return <>
    {guestBar}{feedViewTabs}
    {electionsPanel}
    <div id="legislative-feed-panel" className="feed-view-panel" role="tabpanel" aria-labelledby={legislativeTabId}>
      <div className="feed-loading">Loading feed...</div>
    </div>
  </>;
  if (error && !sameDelegation) return <>
    {guestBar}{feedViewTabs}
    {electionsPanel}
    <div id="legislative-feed-panel" className="feed-view-panel" role="tabpanel" aria-labelledby={legislativeTabId}>
      <div className="error">{error}</div>
    </div>
  </>;
  if (!feedState?.votes) return <>
    {guestBar}{feedViewTabs}
    {electionsPanel}
    <div id="legislative-feed-panel" className="feed-view-panel" role="tabpanel" aria-labelledby={legislativeTabId}>
      <div>Missing feed data</div>
    </div>
  </>;

  return (
    <>
      {guestBar}
      {feedViewTabs}
      {electionsPanel}
      <div id="legislative-feed-panel" className="feed-view-panel" role="tabpanel"
        aria-labelledby={legislativeTabId}>
      <RepCard
        chamber={selectedChamber}
        onChamberChange={setSelectedChamber}
        rep={rep}
        location={cardLocation}
        alignment={isCurrentFeed ? alignmentForCard : null}
        alignmentPolicyArea={feedState?.selectedPolicyArea ?? null}
        alignmentError={alignmentError}
        hideChamberTabs
      ></RepCard>

      <section className="feed-section">
        <h2 className="section-title">Legislative Feed</h2>
        {isCurrentFeed && feedState?.warnings?.filter(warning => warning.code === "PUBLIC_COMMENT_COUNTS_UNAVAILABLE")
          .map(warning => <p key={warning.code} role="status">{warning.message}</p>)}
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
        {feedPending && <p role="status">Loading feed...</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!feedPending && !error && votes.length === 0 && <p>No eligible votes found for this delegation.</p>}

        {stanceError && <p className="error-text" role="alert">{stanceError}</p>}
        {votes.map(vote => (
          <LegislativeVoteCard key={vote.id}
            vote={vote}
            interactions={interactions}
            isAuthed={isAuthed}
            stancePending={stancePending}
            showOriginalByCard={showOriginalByCard}
            aiLoadingByBill={aiLoadingByBill}
            aiSummaryByBill={aiSummaryByBill}
            aiErrorByBill={aiErrorByBill}
            setShowOriginalByCard={setShowOriginalByCard}
            loadAiSummary={loadAiSummary}
            goToBill={goToBill}
            handleStance={handleStance}
            handleCommentIntent={handleCommentIntent}
          />
        ))}
        {hasMore && (
          <div ref={sentinelRef} className="feed-loading">
            <div>{isFetchingMore ? "Loading more..." : "Scroll for more"}</div>
          </div>
        )}
      </section>
      </div>
    </>
  );
}

export default Feed;
