import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { AlignmentGauge } from "../RepCard.jsx";
import ElectionCandidateNavigation from "./ElectionCandidateNavigation";
import { createElectionHttpClient } from "./electionFeedApi.js";
import "./ElectionsPanel.css";

const FIXTURE_DATA_ENABLED = import.meta.env.DEV &&
  import.meta.env.VITE_ELECTION_FIXTURES === "true";
const PAGE_SIZE = 10;
const FIXTURE_GEOGRAPHY = Object.freeze({ status: "verified", state: "NY", houseDistrict: 13 });
const UNAVAILABLE_GEOGRAPHY = Object.freeze({ status: "unavailable", state: null, houseDistrict: null });
const POLICY_AREA_LABELS = Object.freeze({
  economy: "Economy",
  healthcare: "Health Care",
  housing: "Housing",
  education: "Education",
  environment: "Energy & Environment",
  immigration: "Immigration",
  "civil-rights": "Civil Rights",
  "public-safety": "Public Safety",
  "foreign-policy": "Foreign Policy",
  government: "Government",
  other: "Other",
});

function initialState() {
  return {
    chamber: "all",
    selectedCandidacyId: null,
    roster: {
      items: [], coverage: null, availability: null, geography: null,
      status: "loading", error: null,
    },
    positions: {
      items: [], coverage: null, policyCounts: null, availability: null,
      page: { snapshotId: null, nextCursor: null, hasMore: false },
      status: "idle", error: null, nextError: null, restartRequired: false,
      refreshing: false, refreshError: null, scopeKey: null,
    },
  };
}

function emptyRosterMessage(chamber, availability) {
  if (chamber === "house" && availability?.house === "geography-unverified") {
    return "House candidates are unavailable until your 2026 House district is verified. Update your saved address to refresh election geography.";
  }
  if (chamber === "senate" && availability?.senate === "geography-unavailable") {
    return "Senate candidates are unavailable because election geography could not be resolved.";
  }
  if (chamber === "all" && availability?.house === "geography-unverified") {
    return "House candidates will appear when the 2026 House district is verified. Senate candidates depend on matching state coverage.";
  }
  if (availability?.overall === "no-race" || availability?.[chamber] === "no-race") {
    return `The service confirmed no matching ${chamber === "house" ? "House" : chamber === "senate" ? "Senate" : "House or Senate"} race for this location.`;
  }
  if (availability?.[chamber] === "coverage-unknown" || availability?.overall === "coverage-unknown") {
    return `Candidate coverage for ${chamber === "house" ? "the House" : chamber === "senate" ? "the Senate" : "these races"} has not been confirmed yet.`;
  }
  return chamber === "all"
    ? "No matching House or Senate candidates are available for this location yet."
    : `No ${chamber === "house" ? "House" : "Senate"} candidates are available for this location yet.`;
}

function mergePositions(previous, next) {
  const merged = new Map(previous.map(item => [item.positionVersionId, item]));
  for (const item of next) merged.set(item.positionVersionId, item);
  return [...merged.values()];
}

function policyLabel(topic) {
  return POLICY_AREA_LABELS[topic] ?? topic.replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function retrievedDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "retrieval date unavailable";
  return `retrieved ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)}`;
}

function alignmentColor(percent) {
  if (percent >= 67) return "#16a34a";
  if (percent >= 40) return "#d97706";
  return "#dc2626";
}

function candidateAvailabilityCopy(availability) {
  const messages = {
    "site-missing": "No current campaign website has been confirmed for this candidate.",
    "site-unverified": "This campaign website needs verification before positions can appear.",
    pending: "Campaign positions are still being processed.",
    "no-positions": "No validated campaign positions are available for this candidate yet.",
    "crawl-failed": "The campaign website could not be read. Previously published positions remain available when present.",
    "extraction-failed": "Campaign position processing failed. Previously published positions remain available when present.",
  };
  return messages[availability] ?? null;
}

function availabilityCopy({ availability, chamber, selectedCandidate, selectedPolicyArea }) {
  if (availability === "geography-unverified") {
    return "Your 2026 House district could not be verified. Senate positions remain available when the service has matching state data.";
  }
  if (availability === "geography-unavailable") {
    return "Election geography could not be resolved for this address.";
  }
  if (availability === "no-race") return "The service confirmed there is no matching race in this scope.";
  if (availability === "coverage-unknown") return "Candidate or position coverage has not been confirmed for this location yet.";
  if (availability === "no-topic-match") return `There are no campaign positions for ${selectedPolicyArea ? policyLabel(selectedPolicyArea) : "this policy area"} in the current scope.`;
  if (selectedCandidate) {
    const detail = candidateAvailabilityCopy(selectedCandidate.availability);
    if (detail) return detail;
  }
  if (chamber === "house" && availability === "pending") return "House campaign positions are still being prepared.";
  return "No campaign positions are available in this view yet.";
}

function ElectionAlignment({ candidate, client, scope, viewer, revision, onRetry }) {
  const [state, setState] = useState({ requestKey: null, status: "loading", data: null, error: null });
  const requestNumber = useRef(0);
  const requestKey = JSON.stringify([
    viewer, candidate.candidacyId, scope.geography.status, scope.geography.state,
    scope.geography.houseDistrict, scope.chamber, scope.policyArea, revision,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestNumber.current;
    let active = true;
    client.readAlignment(scope, { signal: controller.signal, viewer }).then(data => {
      if (!active || requestNumber.current !== requestId) return;
      setState({ requestKey, status: data.status, data, error: null });
    }).catch(error => {
      if (!active || error?.name === "AbortError") return;
      setState({ requestKey, status: "error", data: null, error: error.code === "AUTHENTICATION_REQUIRED"
        ? "Your session expired. Sign in again to refresh alignment."
        : "Alignment could not be refreshed." });
    });
    return () => {
      active = false;
      requestNumber.current += 1;
      controller.abort();
    };
  }, [client, requestKey, scope, viewer]);

  const viewState = state.requestKey === requestKey ? state : { status: "loading", data: null, error: null };
  const hasData = viewState.status === "ready" && viewState.data?.answeredCount > 0 && Number.isFinite(viewState.data?.percentage);
  const percent = hasData ? Math.max(0, Math.min(100, viewState.data.percentage)) : 0;
  return (
    <section className="member-alignment election-alignment" aria-label={`Alignment with ${candidate.name}`}
      style={{ "--alignment-accent": alignmentColor(percent) }}>
      <div className="member-alignment-text">
        <div className="member-alignment-label">Your alignment with {candidate.name}</div>
      </div>
      {viewState.status === "loading" ? (
        <p className="member-alignment-empty" role="status">Loading your campaign-position alignment…</p>
      ) : viewState.status === "error" ? (
        <div className="election-alignment-error" role="alert">
          <p>{viewState.error}</p>
          {viewState.error?.includes("session expired") && <Link to="/login">Sign in again</Link>}
          <button type="button" onClick={onRetry}>Retry alignment</button>
        </div>
      ) : viewState.status === "sign-in-required" ? (
        <p className="member-alignment-empty">Sign in to respond to campaign positions and see your alignment.</p>
      ) : (
        <>
          <AlignmentGauge percent={percent} hasData={hasData} emptyLabel="—" />
          <div className="member-alignment-text">
            <p className="member-alignment-copy">
              {hasData ? <>
                You agree with <span className="member-alignment-emphasis">{viewState.data.agreementCount}</span>
                {" "}out of <span className="member-alignment-emphasis">{viewState.data.answeredCount}</span> answered campaign positions
                {scope.policyArea ? ` in ${policyLabel(scope.policyArea)}` : ""}.
              </> : <>Agree or disagree with a campaign position to see your alignment.</>}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function PositionCard({ item, pending, failure, viewer, onResponse }) {
  const candidateName = item.candidate?.name ?? "Candidate";
  const stance = item.response?.stance ?? null;
  const sourceUrl = safeSourceUrl(item.source?.url);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const ballotNotice = item.ballotStatus === "unknown"
    ? "Ballot access has not been confirmed by a state source."
    : null;

  function responseButton(value, label, icon) {
    const selected = stance === value;
    return (
      <button type="button" className={`election-response-button election-response-${value} ${selected ? "is-selected" : ""}`}
        aria-pressed={selected} aria-label={`${selected ? "Clear" : label} ${selected ? "response for" : "with"} ${candidateName}`}
        disabled={pending} onClick={() => onResponse(item, selected ? null : value)}>
        {icon}
        <span>{selected ? value === "agree" ? `I agree with ${candidateName}` : "I disagree" : label}</span>
      </button>
    );
  }

  return (
    <article className="election-position-card" data-position-version-id={item.positionVersionId}>
      <div className="election-position-portrait-wrap">
        {item.candidate?.portraitUrl && !portraitFailed ? (
          <img className="election-position-portrait" src={item.candidate.portraitUrl}
            alt={`${candidateName} portrait`} onError={() => setPortraitFailed(true)} />
        ) : (
          <span className="election-position-initials" role="img" aria-label={`${candidateName} portrait unavailable`}>
            {candidateName.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?"}
          </span>
        )}
      </div>
      <div className="election-position-content">
        <div className="election-position-candidate">
          <strong>{candidateName}</strong>
          {item.candidate?.incumbency === "incumbent" && <span className="election-incumbent-badge">Incumbent</span>}
        </div>
        <p className="election-position-summary">{item.summary}</p>
        {ballotNotice && <p className="election-ballot-notice">{ballotNotice}</p>}
        <div className="election-position-source-row">
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer"
              aria-label={`Open ${candidateName}'s campaign source in a new tab, ${retrievedDate(item.source?.retrievedAt)}`}>
              <span aria-hidden="true">↗</span> Campaign source
            </a>
          ) : <span>Campaign source unavailable</span>}
          <time dateTime={item.source?.retrievedAt}>{retrievedDate(item.source?.retrievedAt)}</time>
        </div>
        <div className="election-position-actions" aria-label={`Respond to ${candidateName}'s campaign position`}>
          {responseButton("agree", "Agree", <ThumbsUp size={18} aria-hidden="true" />)}
          {responseButton("disagree", "Disagree", <ThumbsDown size={18} aria-hidden="true" />)}
          {pending && <span className="election-response-pending" role="status">Saving…</span>}
          {failure && (
            <span className="election-response-error" role="alert">
              {failure.message}{" "}
              {failure.message?.includes("session expired") && <Link to="/login">Sign in again</Link>}{" "}
              <button type="button" disabled={pending} onClick={() => onResponse(item, failure.intent)}>Retry</button>
            </span>
          )}
          {viewer === "guest" && <span className="sr-only">Sign in to save a response.</span>}
        </div>
      </div>
    </article>
  );
}

export default function ElectionsPanel({
  viewer,
  location = null,
  authFetch,
  onGuestResponseAttempt = () => {},
  hidden = false,
}) {
  const { panelPolicyState, setPanelPolicyArea, setPanelPolicyData } = useOutletContext();
  const [electionState, setElectionState] = useState(initialState);
  const [client, setClient] = useState(null);
  const [rosterRetry, setRosterRetry] = useState(0);
  const [feedRetry, setFeedRetry] = useState(0);
  const [alignmentRetry, setAlignmentRetry] = useState(0);
  const [alignmentRevision, setAlignmentRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingResponses, setPendingResponses] = useState({});
  const [responseFailures, setResponseFailures] = useState({});
  const [buildJobs, setBuildJobs] = useState([]);
  const sentinelRef = useRef(null);
  const pageControllerRef = useRef(null);
  const currentScopeKeyRef = useRef(null);
  const buildJobsRef = useRef([]);
  const selectedPolicyArea = panelPolicyState.elections.selectedPolicyArea;
  const guestAddress = viewer === "guest" ? location?.address ?? null : null;
  const applyBuildJobs = useCallback(next => {
    const previous=buildJobsRef.current;
    const previousById=new Map(previous.map(job=>[job.id,job]));
    const current=next.map(job=>{
      const saved=previousById.get(job.id);
      return saved && Date.parse(saved.updatedAt)>Date.parse(job.updatedAt) ? saved : job;
    });
    const wasActive=previous.some(job=>job.status==="queued"||job.status==="running");
    const isActive=current.some(job=>job.status==="queued"||job.status==="running");
    buildJobsRef.current=current;
    setBuildJobs(current);
    if (wasActive && !isActive) {
      setRosterRetry(value=>value+1);
      setFeedRetry(value=>value+1);
    }
  },[]);

  useEffect(() => {
    let active = true;
    if (FIXTURE_DATA_ENABLED) {
      import("./electionFeedFixtures.js").then(({ createElectionFixtureClient }) => {
        if (active) setClient(createElectionFixtureClient());
      });
    } else {
      setClient(createElectionHttpClient({ viewer, address: guestAddress, authFetch }));
    }
    return () => {
      active = false;
      pageControllerRef.current?.abort();
    };
  }, [viewer, guestAddress, authFetch]);

  const geography = useMemo(() => electionState.roster.geography ?? (FIXTURE_DATA_ENABLED
    ? FIXTURE_GEOGRAPHY : UNAVAILABLE_GEOGRAPHY), [electionState.roster.geography]);
  const feedScope = useMemo(() => ({
    geography,
    chamber: electionState.chamber,
    candidacyId: electionState.selectedCandidacyId,
    policyArea: selectedPolicyArea,
  }), [geography, electionState.chamber, electionState.selectedCandidacyId, selectedPolicyArea]);
  const scopeKey = useMemo(() => JSON.stringify([
    viewer, geography.status, geography.state, geography.houseDistrict,
    location?.electionGeographyEvidenceId ?? null,
    feedScope.chamber, feedScope.candidacyId, feedScope.policyArea,
  ]), [viewer, geography, location?.electionGeographyEvidenceId, feedScope]);
  currentScopeKeyRef.current = scopeKey;

  const policyCounts = electionState.positions.policyCounts;
  const policyAreas = useMemo(() => policyCounts
    ? Object.entries(policyCounts.byPolicyArea ?? {}).map(([value, count]) => ({
      name: value,
      value,
      label: policyLabel(value),
      count,
    }))
    : [], [policyCounts]);

  useEffect(() => {
    setPanelPolicyData("elections", {
      policyAreas,
      totalPolicyCount: policyCounts?.all ?? null,
    });
  }, [policyAreas, policyCounts, setPanelPolicyData]);

  useEffect(() => {
    if (!client) return undefined;
    const controller = new AbortController();
    let active = true;
    setElectionState(current => ({ ...current, roster: {
      ...current.roster,
      items: current.roster.items.length && current.chamber === electionState.chamber ? current.roster.items : [],
      status: "loading", error: null,
    } }));
    client.readRoster({ chamber: electionState.chamber }, { signal: controller.signal, viewer }).then(result => {
      if (!active) return;
      setElectionState(current => ({ ...current, roster: {
        items: result.candidates ?? [],
        coverage: result.coverage ?? null,
        availability: result.availability ?? null,
        geography: result.geography ?? null,
        status: "ready",
        error: null,
      } }));
      applyBuildJobs(result.builds ?? []);
    }).catch(error => {
      if (!active || error?.name === "AbortError") return;
      setElectionState(current => ({ ...current, roster: {
        ...current.roster,
        status: "error",
        error: error.code === "AUTHENTICATION_REQUIRED"
          ? "Your session expired. Sign in again to load candidates."
          : "We couldn’t load candidates. Try again.",
      } }));
    });
    return () => { active = false; controller.abort(); };
  }, [applyBuildJobs, client, electionState.chamber, rosterRetry, viewer]);

  useEffect(() => {
    if (!client || !geography.state) return undefined;
    const controller=new AbortController();
    let active=true, timer=null;
    const poll=async()=>{
      try {
        const result=await client.readBuildStatus({chamber:electionState.chamber},{signal:controller.signal,viewer});
        if (!active) return;
        const jobs=result.builds ?? [];
        applyBuildJobs(jobs);
        if (jobs.some(job=>job.status==="queued"||job.status==="running")) timer=setTimeout(poll,4000);
      } catch (error) {
        if (!active || error?.name==="AbortError") return;
        timer=setTimeout(poll,8000);
      }
    };
    poll();
    return ()=>{ active=false; controller.abort(); if (timer) clearTimeout(timer); };
  },[applyBuildJobs,client,electionState.chamber,geography.state,viewer]);

  const selectChamber = useCallback(chamber => {
    setElectionState(current => ({
      ...current,
      chamber,
      selectedCandidacyId: null,
      roster: { ...current.roster, items: [], status: "loading", error: null },
    }));
    buildJobsRef.current=[];
    setBuildJobs([]);
  }, []);

  useEffect(() => {
    if (electionState.roster.status !== "ready" || !electionState.selectedCandidacyId) return;
    if (!electionState.roster.items.some(candidate => candidate.candidacyId === electionState.selectedCandidacyId)) {
      setElectionState(current => ({ ...current, selectedCandidacyId: null }));
    }
  }, [electionState.roster.items, electionState.roster.status, electionState.selectedCandidacyId]);

  useEffect(() => {
    if (!client) return undefined;
    const controller = new AbortController();
    pageControllerRef.current?.abort();
    pageControllerRef.current = controller;
    let active = true;
    const requestScopeKey = scopeKey;
    setElectionState(current => {
      const hasCurrentScopeData = current.positions.scopeKey === requestScopeKey &&
        current.positions.status === "ready";
      return { ...current, positions: hasCurrentScopeData
        ? {
          ...current.positions,
          refreshing: true,
          refreshError: null,
          nextError: null,
          restartRequired: false,
        }
        : {
          items: [], coverage: null, policyCounts: null, availability: null,
          page: { snapshotId: null, nextCursor: null, hasMore: false },
          status: "loading", error: null, nextError: null, restartRequired: false,
          refreshing: false, refreshError: null, scopeKey: requestScopeKey,
        },
      };
    });
    setLoadingMore(false);
    setPendingResponses({});
    setResponseFailures({});

    const options = { signal: controller.signal, viewer, limit: PAGE_SIZE };
    client.readPositions(feedScope, options).then(page => {
      if (!active || currentScopeKeyRef.current !== requestScopeKey) return;
      setElectionState(current => ({ ...current, positions: {
        items: page.items ?? [],
        coverage: page.coverage ?? null,
        policyCounts: page.policyCounts ?? null,
        availability: page.availability ?? null,
        page: { snapshotId: page.snapshotId ?? null, nextCursor: page.nextCursor ?? null, hasMore: Boolean(page.nextCursor) },
        status: "ready", error: null,
        nextError: null,
        restartRequired: false,
        refreshing: false,
        refreshError: null,
        scopeKey: requestScopeKey,
      } }));
      applyBuildJobs(page.builds ?? []);
    }).catch(error => {
      if (!active || error?.name === "AbortError" || currentScopeKeyRef.current !== requestScopeKey) return;
      setElectionState(current => {
        if (current.positions.scopeKey === requestScopeKey && current.positions.status === "ready") {
          return { ...current, positions: {
            ...current.positions,
            refreshing: false,
            refreshError: error.code === "AUTHENTICATION_REQUIRED"
              ? "Your session expired. Sign in again to refresh campaign positions."
              : "We couldn't refresh campaign positions.",
          } };
        }
        return { ...current, positions: {
          ...current.positions,
          status: "error",
          refreshing: false,
          error: error.code === "AUTHENTICATION_REQUIRED"
            ? "Your session expired. Sign in again to load campaign positions."
            : "We couldn’t load campaign positions. Try again.",
        } };
      });
    });

    return () => { active = false; controller.abort(); };
  }, [applyBuildJobs, client, feedScope, scopeKey, feedRetry, viewer]);

  const loadMore = useCallback(async () => {
    const current = electionState.positions;
    if (!client || !current.page.hasMore || loadingMore || current.status !== "ready" || current.restartRequired) return;
    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    pageControllerRef.current = controller;
    setLoadingMore(true);
    setElectionState(value => ({ ...value, positions: { ...value.positions, nextError: null } }));
    try {
      const page = await client.readPositions(feedScope, {
        signal: controller.signal, viewer, limit: PAGE_SIZE, cursor: current.page.nextCursor,
      });
      if (currentScopeKeyRef.current !== requestScopeKey) return;
      setElectionState(value => ({ ...value, positions: {
        ...value.positions,
        items: mergePositions(value.positions.items, page.items ?? []),
        coverage: page.coverage ?? value.positions.coverage,
        availability: page.availability ?? value.positions.availability,
        page: { snapshotId: page.snapshotId ?? value.positions.page.snapshotId,
          nextCursor: page.nextCursor ?? null, hasMore: Boolean(page.nextCursor) },
        nextError: null,
      } }));
    } catch (error) {
      if (error?.name !== "AbortError" && currentScopeKeyRef.current === requestScopeKey) {
        setElectionState(value => ({ ...value, positions: {
          ...value.positions,
          nextError: error.restartFromFirstPage
            ? "This Elections publication changed. Restart to continue."
            : "The next page could not be loaded. Your current positions are still here.",
          restartRequired: Boolean(error.restartFromFirstPage),
        } }));
      }
    } finally {
      if (currentScopeKeyRef.current === requestScopeKey) setLoadingMore(false);
    }
  }, [client, electionState.positions, feedScope, loadingMore, scopeKey, viewer]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !electionState.positions.page.hasMore || electionState.positions.status !== "ready" || loadingMore) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: "260px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [electionState.positions.page.hasMore, electionState.positions.status, loadingMore, loadMore]);

  const selectedCandidate = electionState.roster.items.find(candidate =>
    candidate.candidacyId === electionState.selectedCandidacyId) ?? null;

  const respondToPosition = useCallback(async (item, intent) => {
    if (viewer === "guest") {
      onGuestResponseAttempt();
      return;
    }
    const id = item.positionVersionId;
    if (!id || pendingResponses[id]) return;
    setPendingResponses(current => ({ ...current, [id]: true }));
    setResponseFailures(current => { const next = { ...current }; delete next[id]; return next; });
    try {
      const result = intent === null
        ? await client.clearResponse({ positionVersionId: id }, { viewer })
        : await client.saveResponse({ positionVersionId: id, stance: intent }, { viewer });
      if (result.status === "sign-in-required") {
        onGuestResponseAttempt();
        return;
      }
      const confirmedStance = result.response?.stance ?? null;
      setElectionState(current => ({ ...current, positions: {
        ...current.positions,
        items: current.positions.items.map(position => position.positionVersionId === id
          ? { ...position, response: confirmedStance ? { stance: confirmedStance } : null }
          : position),
      } }));
      setAlignmentRevision(value => value + 1);
    } catch (error) {
      setResponseFailures(current => ({ ...current, [id]: {
        intent,
        message: error.code === "AUTHENTICATION_REQUIRED"
          ? "Your session expired; sign in again before saving."
          : "Your response wasn’t saved.",
      } }));
    } finally {
      setPendingResponses(current => { const next = { ...current }; delete next[id]; return next; });
    }
  }, [client, onGuestResponseAttempt, pendingResponses, viewer]);

  const coverage = electionState.positions.coverage ?? electionState.roster.coverage;
  const showHouseWarning = electionState.roster.availability?.house === "geography-unverified" &&
    electionState.chamber !== "house";
  const activeBuildCount=buildJobs.filter(job=>job.status==="queued"||job.status==="running").length;
  const buildNeedsRetry=buildJobs.some(job=>job.status==="partial"||job.status==="failed");

  return (
    <section id="elections-feed-panel" className="elections-panel" role="tabpanel"
      data-viewer={viewer} aria-labelledby="feed-view-tab-elections" tabIndex={0}
      aria-busy={electionState.positions.refreshing} hidden={hidden}>
      {FIXTURE_DATA_ENABLED && (
        <p className="elections-fixture-notice" role="note">
          Development fixture data — fictional candidates, not live election results.
        </p>
      )}
      {showHouseWarning && (
        <p className="election-geography-notice" role="status">
          Senate candidates can still appear. Your 2026 House district has not been verified.
        </p>
      )}
      {coverage?.status !== "complete" && coverage?.message && (
        <p className="election-coverage-notice" role="status">{coverage.message}</p>
      )}
      {activeBuildCount>0 && (
        <p className="election-build-notice" role="status">
          We’re preparing the election feed for your location. This can take a few minutes.
        </p>
      )}
      {buildNeedsRetry && activeBuildCount===0 && (
        <p className="election-build-notice" role="status">
          Some candidate or campaign information could not be prepared. Any saved positions remain available, and incomplete work can retry on a later request.
        </p>
      )}
      <ElectionCandidateNavigation
        chamber={electionState.chamber}
        onChamberChange={selectChamber}
        roster={electionState.roster.items}
        rosterStatus={electionState.roster.status}
        rosterError={electionState.roster.error}
        onRetry={() => setRosterRetry(value => value + 1)}
        emptyMessage={emptyRosterMessage(electionState.chamber, electionState.roster.availability)}
        selectedCandidacyId={electionState.selectedCandidacyId}
        onSelectCandidate={candidacyId => setElectionState(current => ({
          ...current,
          selectedCandidacyId: candidacyId,
        }))}
      />

      {selectedCandidate && (
        <div className="election-selected-candidate-summary">
          <p className="election-selected-candidate-label">Positions from {selectedCandidate.name}</p>
          <button type="button" className="election-all-candidates-reset"
            onClick={() => setElectionState(current => ({ ...current, selectedCandidacyId: null }))}>
            All candidates
          </button>
          {client && <ElectionAlignment candidate={selectedCandidate} client={client} scope={feedScope}
            viewer={viewer} revision={alignmentRetry + alignmentRevision}
            onRetry={() => setAlignmentRetry(value => value + 1)} />}
        </div>
      )}

      <div className="election-campaign-heading">
        <div>
          <h2>Campaign Positions</h2>
          <p>Policy positions from candidates’ official campaign websites.</p>
          {selectedCandidate && <span className="election-selected-scope">
            {selectedPolicyArea ? policyLabel(selectedPolicyArea) : "All policy areas"}
          </span>}
        </div>
        <label className="election-policy-select-label">
          <span className="sr-only">Filter by policy area</span>
          <select value={selectedPolicyArea ?? ""}
            onChange={event => setPanelPolicyArea("elections", event.target.value || null)}>
            <option value="">All Policy Areas{policyCounts?.all != null ? ` (${policyCounts.all})` : ""}</option>
            {policyAreas.map(area => (
              <option key={area.value} value={area.value}>
                {area.label}{area.count != null ? ` (${area.count})` : ""}
              </option>
            ))}
            {policyCounts?.uncategorized > 0 && <option value="uncategorized">
              Uncategorized ({policyCounts.uncategorized})
            </option>}
          </select>
        </label>
      </div>

      {electionState.positions.status === "loading" && (
        <p className="election-feed-status" role="status">Loading campaign positions…</p>
      )}
      {electionState.positions.status === "error" && (
        <div className="election-feed-error" role="alert">
          <p>{electionState.positions.error}</p>
          <button type="button" onClick={() => setFeedRetry(value => value + 1)}>Retry</button>
          {electionState.positions.error.includes("session expired") && <Link to="/login">Sign in again</Link>}
        </div>
      )}
      {electionState.positions.refreshError && (
        <div className="election-next-page-error" role="status">
          <p>{electionState.positions.refreshError}{electionState.positions.items.length > 0
            ? " Previously loaded positions are still shown."
            : ""}</p>
          {electionState.positions.refreshError.includes("session expired") && <Link to="/login">Sign in again</Link>}
          <button type="button" onClick={() => setFeedRetry(value => value + 1)}>Retry</button>
        </div>
      )}
      {electionState.positions.status === "ready" && electionState.positions.items.length === 0 && (
        <p className="election-feed-empty" role="status">
          {availabilityCopy({
            availability: electionState.positions.availability,
            chamber: electionState.chamber,
            selectedCandidate,
            selectedPolicyArea,
          })}
        </p>
      )}
      {electionState.positions.nextError && (
        <div className="election-next-page-error" role="alert">
          <p>{electionState.positions.nextError}</p>
          {electionState.positions.restartRequired ? (
            <button type="button" onClick={() => setFeedRetry(value => value + 1)}>Restart feed</button>
          ) : (
            <button type="button" disabled={loadingMore} onClick={loadMore}>Retry next page</button>
          )}
        </div>
      )}
      {electionState.positions.items.map(item => (
        <PositionCard key={item.positionVersionId} item={item}
          pending={Boolean(pendingResponses[item.positionVersionId])}
          failure={responseFailures[item.positionVersionId]}
          viewer={viewer} onResponse={respondToPosition} />
      ))}
      {loadingMore && <p className="election-feed-status" role="status">Loading more campaign positions…</p>}
      {electionState.positions.page.hasMore && <div ref={sentinelRef} className="election-feed-sentinel" aria-hidden="true" />}
      {electionState.positions.status === "ready" && !electionState.positions.page.hasMore && electionState.positions.items.length > 0 && (
        <p className="election-feed-end" role="status">End of campaign positions.</p>
      )}
    </section>
  );
}
