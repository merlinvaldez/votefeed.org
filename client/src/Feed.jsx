import { useEffect, useEffectEvent, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";
import RepCard from "./RepCard";
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

const getVoteClass = (vote = "") => {
  if (["Yea", "Aye", "Yes"].includes(vote)) return "success";
  if (["Nay", "No"].includes(vote)) return "danger";
  return "neutral";
};

const buildFeedUrl = ({
  isGuest,
  repId,
  pageSize,
  offset = 0,
  policyArea = null,
}) => {
  const baseUrl = isGuest
    ? `${API_BASE}/housevotes/member/${repId}`
    : `${API_BASE}/users/me/feed`;
  const params = new URLSearchParams();
  if (!policyArea) {
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
  }
  if (policyArea) {
    params.set("policyArea", policyArea);
  }
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

const buildAlignmentUrl = ({ repId, policyArea = null }) => {
  const params = new URLSearchParams({
    repBioguideId: repId,
  });
  if (policyArea) {
    params.set("policyArea", policyArea);
  }
  return `${API_BASE}/users/me/alignment?${params.toString()}`;
};

function Feed(props) {
  const PAGE_SIZE = 5;
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

  const [feedState, setFeedState] = useState(location.state || props.state);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);

  const [interactions, setInteractions] = useState([]);
  const [userId, setUserId] = useState(null);
  const [hasMore, setHasmore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef(null);
  const votes = useMemo(() => feedState?.votes ?? [], [feedState?.votes]);

  const [showOriginalByCard, setShowOriginalByCard] = useState({});
  const [aiSummaryByBill, setAiSummaryByBill] = useState({});
  const [aiLoadingByBill, setAiLoadingByBill] = useState({});
  const [aiErrorByBill, setAiErrorByBill] = useState({});
  const [mobilePolicySearch, setMobilePolicySearch] = useState("");
  const [isMobilePolicySearchOpen, setIsMobilePolicySearchOpen] =
    useState(false);
  const isFilteringByPolicy = selectedPolicyArea !== null;
  const availablePolicyAreas = feedState?.policyAreas ?? [];
  const totalPolicyCount = feedState?.totalPolicyCount ?? 0;
  const normalizedMobilePolicySearch = mobilePolicySearch.trim().toLowerCase();
  const mobileVisiblePolicyAreas = availablePolicyAreas.filter((policyArea) =>
    policyArea.name.toLowerCase().includes(normalizedMobilePolicySearch),
  );

  useEffect(() => {
    setSidebarPolicyAreas(feedState?.policyAreas ?? []);
    setSidebarTotalPolicyCount(feedState?.totalPolicyCount ?? 0);
    setSelectedPolicyArea(feedState?.selectedPolicyArea ?? null);
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

  const loadAiSummary = useEffectEvent(async (billType, billNumber, forceRetry = false) => {
    const billIdentity = `${billType}-${billNumber}`;
    if (
      !forceRetry && 
      (aiSummaryByBill[billIdentity] ||
      aiLoadingByBill[billIdentity] ||
      aiErrorByBill[billIdentity])
    ) {
      return;
    }
    setAiLoadingByBill((prev) => ({ ...prev, [billIdentity]: true }));
    setAiErrorByBill((prev) => ({ ...prev, [billIdentity]: null }));
    try {
      const resp = await fetch(
        `${API_BASE}/bills/${billType}/${billNumber}/ai-summary`,
      );
      if (!resp.ok) throw new Error("Ai summary failed");
      const data = await resp.json();
      setAiSummaryByBill((prev) => ({
        ...prev,
        [billIdentity]: data.aiSummary,
      }));
    } catch {
      setAiErrorByBill((prev) => ({
        ...prev,
        [billIdentity]: "AI summary failed",
      }));
    } finally {
      setAiLoadingByBill((prev) => ({ ...prev, [billIdentity]: false }));
    }
  });

  useEffect(() => {
    votes.forEach((vote) => {
      if (!vote.legislation_type || !vote.legislationnumber) return;
      loadAiSummary(vote.legislation_type, vote.legislationnumber);
    });
  }, [votes]);

  useEffect(() => {
    if (token) return;
    if (feedState?.rep && feedState?.votes) return;
    navigate("/", { replace: true });
  }, [token, feedState, navigate]);

  useEffect(() => {
    if (feedState?.rep && feedState?.votes) return;
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const resp = await authFetch(
          buildFeedUrl({
            isGuest: false,
            pageSize: PAGE_SIZE,
            offset: 0,
            policyArea: selectedPolicyArea,
          }),
        );
        if (!resp.ok) throw new Error("Failed to load feed");
        const feed = await resp.json();
        if (!cancelled) setFeedState(feed);
        if (!cancelled)
          setHasmore(
            selectedPolicyArea === null && feed.votes.length === PAGE_SIZE,
          );
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load feed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedState, token, authFetch, selectedPolicyArea]);

  useEffect(() => {
    const currentPolicyArea = feedState?.selectedPolicyArea ?? null;
    const repId = feedState?.rep?.bioguideid;
    if (selectedPolicyArea === currentPolicyArea) return;
    if (!token && !repId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");
        const isGuest = !token;
        const url = buildFeedUrl({
          isGuest,
          repId,
          pageSize: PAGE_SIZE,
          offset: 0,
          policyArea: selectedPolicyArea,
        });
        const resp = isGuest ? await fetch(url) : await authFetch(url);
        if (!resp.ok) throw new Error("Failed to filter feed");
        const nextFeed = await resp.json();
        if (cancelled) return;
        setFeedState((prev) => ({
          ...prev,
          ...nextFeed,
          rep: nextFeed.rep ?? prev?.rep ?? null,
        }));
        setHasmore(
          selectedPolicyArea === null &&
            (nextFeed.votes?.length ?? 0) === PAGE_SIZE,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to filter feed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authFetch,
    feedState?.rep?.bioguideid,
    feedState?.selectedPolicyArea,
    selectedPolicyArea,
    token,
  ]);

  const loadMoreVotes = useEffectEvent(async () => {
    if (isFetchingMore) return;
    setIsFetchingMore(true);
    try {
      const offset = votes.length;
      const repId = feedState?.rep?.bioguideid;
      const isGuest = !token;
      const url = buildFeedUrl({
        isGuest,
        repId,
        pageSize: PAGE_SIZE,
        offset,
        policyArea: selectedPolicyArea,
      });
      const resp = isGuest ? await fetch(url) : await authFetch(url);
      if (!resp.ok) throw new Error("Failed to load more votes");
      const nextFeed = await resp.json();
      const nextVotes = nextFeed.votes ?? [];
        setFeedState((prev) => ({
          ...prev,
          ...nextFeed,
          rep: nextFeed.rep ?? prev?.rep ?? null,
          votes: [...(prev?.votes ?? []), ...nextVotes],
        }));
        setHasmore(nextVotes.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || "Failed to load more votes");
    } finally {
      setIsFetchingMore(false);
    }
  });

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (selectedPolicyArea !== null) return;
        if (!token && !feedState?.rep) return;
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
    feedState?.rep,
    hasMore,
    isFetchingMore,
    loading,
    votes.length,
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
        if (!cancelled) setUserId(me.id);

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
  }, [token, authFetch]);

  const interactionsByBill = {};
  for (const interaction of interactions) {
    interactionsByBill[interaction.bill_id] = interaction;
  }
  const rep = feedState?.rep;
  const alignmentForCard = feedState?.alignment ?? null;

  const refreshAlignmentSummary = useEffectEvent(async () => {
    if (!token || !rep?.bioguideid) return;
    const resp = await authFetch(
      buildAlignmentUrl({
        repId: rep.bioguideid,
        policyArea: selectedPolicyArea,
      }),
    );
    if (!resp.ok) throw new Error("Failed to refresh alignment");
    const alignment = await resp.json();
    setFeedState((prev) =>
      prev
        ? {
            ...prev,
            alignment,
          }
        : prev,
    );
  });

  const handleStance = async (billId, stance) => {
    if (!userId) {
      promptGuestInteraction();
      return;
    }

    try {
      const existing = interactionsByBill[billId];
      if (existing?.stance === stance) {
        const resp = await authFetch(
          `${API_BASE}/interactions/${existing.id}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error("Failed to delete stance");
        setInteractions((prev) => prev.filter((i) => i.id !== existing.id));
        await refreshAlignmentSummary();
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
              ? { stance }
              : {
                  user_id: userId,
                  bill_id: billId,
                  rep_bioguide_id: rep.bioguideid,
                  stance,
                },
          ),
        },
      );
      if (!resp.ok) throw new Error("Failed to save stance");
      const saved = await resp.json();

      setInteractions((prev) => {
        const withoutCurrent = prev.filter((i) => i.id !== saved.id);
        return [...withoutCurrent, saved];
      });
      await refreshAlignmentSummary();
    } catch (err) {
      setError(err.message || "Failed to save stance");
    }
  };

  if (loading) return <div className="feed-loading">Loading feed...</div>;
  if (error) return <div className="error">{error}</div>;

  if (!feedState?.rep || !feedState?.votes) {
    return <div>Missing feed data</div>;
  }
  const repLastName = getRepLastName(rep.full_name);
  const memberTitle = String(rep.chamber || "")
    .toLowerCase()
    .includes("senate")
    ? "Sen."
    : "Rep.";

  const goToBill = (vote) => {
    const billNumber = vote.legislationnumber;
    const billType = vote.legislation_type;
    navigate(`/bill/${billType}/${billNumber}`, { state: { rep, bill: vote } });
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
              <div className="guest-sub">Your interactions won’t be saved.</div>
            </div>
          </div>
          <button className="guest-cta" onClick={() => navigate("/signup")}>
            Sign Up / Sign In
          </button>
        </div>
      )}

      <RepCard
        rep={rep}
        alignment={alignmentForCard}
        alignmentPolicyArea={feedState?.selectedPolicyArea ?? null}
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
        {votes.length === 0 && <p>No votes found for this member.</p>}

        {votes.map((vote) => {
          const interaction = interactionsByBill[vote.bill_id];
          const billType = vote.legislation_type;
          const billNumber = vote.legislationnumber;
          const billIdentity = `${billType}-${billNumber}`;
          const voteKey = `${vote.legislationnumber}-${vote.session_number}-${vote.roll_call_number}`;
          const billLabel = formatBillLabel(
            vote.legislation_type,
            vote.legislationnumber,
          );
          const showOriginal = Boolean(showOriginalByCard[voteKey]);
          const isLoadingAi = aiLoadingByBill[billIdentity];
          const aiText = aiSummaryByBill[billIdentity];
          const aiError = aiErrorByBill[billIdentity];
          const legislationType = formatLegislationType(billType);
          const voteClass = getVoteClass(vote.vote);
          const isNotVoting = vote.vote === "Not Voting";
          const useOfficialSummary = showOriginal || aiError;
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
                      onClick={() => loadAiSummary(vote.legislation_type, vote.legislationnumber, true)}
                      style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
              {useOfficialSummary ? (
                <div
                  className="leg-body"
                  dangerouslySetInnerHTML={{ __html: vote.summary }}
                />
              ) : isLoadingAi || !aiText ? (
                <div className="leg-body">Creating summary.</div>
              ) : (
                <div className="leg-body simple-vote-summary">
                  {memberTitle} {repLastName}{" "}
                  {isNotVoting ? (
                    <>did not vote</>
                  ) : (
                    <>
                      voted{" "}
                      <span className={`pill inline-vote-pill ${voteClass}`}>
                        {vote.vote}
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
              <div className="leg-actions">
                <button
                  type="button"
                  className={`ghost-btn ${
                    interaction?.stance === "approve" ? "active approve" : ""
                  }`}
                  onClick={() => handleStance(vote.bill_id, "approve")}
                  aria-label={`Agree with Rep. ${repLastName}`}
                  aria-pressed={interaction?.stance === "approve"}
                  title={`Agree with Rep. ${repLastName}`}
                >
                  <ThumbsUp size={16} />
                  {interaction?.stance === "approve" && (
                    <span>I agree with Rep. {repLastName}</span>
                  )}
                </button>

                <button
                  type="button"
                  className={`ghost-btn ${
                    interaction?.stance === "disapprove"
                      ? "active disapprove"
                      : ""
                  }`}
                  onClick={() => handleStance(vote.bill_id, "disapprove")}
                  aria-label={`Disagree with Rep. ${repLastName}`}
                  aria-pressed={interaction?.stance === "disapprove"}
                  title={`Disagree with Rep. ${repLastName}`}
                >
                  <ThumbsDown size={16} />
                  {interaction?.stance === "disapprove" && (
                    <span>I disagree with Rep. {repLastName}</span>
                  )}
                </button>

                <div
                  className="comments"
                  onClick={() => handleCommentIntent(vote)}
                  style={{ cursor: "pointer" }}
                >
                  <MessageCircle size={16} />
                  {interaction?.user_comment ? "1 Comment" : "0 Comments"}
                </div>
              </div>
            </div>
          );
        })}
        {!isFilteringByPolicy && hasMore && (
          <div ref={sentinelRef} className="feed-loading">
            <div>{isFetchingMore ? "Loading more..." : "Scroll for more"}</div>
          </div>
        )}
      </section>
    </>
  );
}

export default Feed;
