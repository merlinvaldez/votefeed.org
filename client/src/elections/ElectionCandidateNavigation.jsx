import { useState } from "react";
import { Building2, Landmark } from "lucide-react";
import { STATES } from "../constants";
import "./ElectionCandidateNavigation.css";

const CHAMBER_TABS = [
  { value: "all", label: "All Candidates" },
  { value: "house", label: "House" },
  { value: "senate", label: "Senate" },
];

function initialsFor(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0][0]}${parts.length > 1 ? parts.at(-1)[0] : ""}`.toUpperCase();
}

function locationFor(candidate) {
  const { race } = candidate;
  const stateName = STATES.find(({ code }) => code === race.state)?.name ?? race.state;
  if (race.office === "house") {
    return race.district == null ? race.state : `${race.state}-${race.district}`;
  }
  return stateName;
}

function partyColor(party) {
  const normalizedParty = String(party ?? "").toLowerCase();
  if (normalizedParty.includes("democrat")) return "democratic";
  if (normalizedParty.includes("republican")) return "republican";
  return "other";
}

function CandidatePortrait({ candidate }) {
  const [imageAvailable, setImageAvailable] = useState(Boolean(candidate.portraitUrl));

  return (
    <span className="election-candidate-portrait">
      {imageAvailable ? (
        <img
          src={candidate.portraitUrl}
          alt={`${candidate.name} portrait`}
          onError={() => setImageAvailable(false)}
        />
      ) : (
        <span className="election-candidate-initials" role="img"
          aria-label={`${candidate.name} portrait unavailable`}>
          {initialsFor(candidate.name)}
        </span>
      )}
    </span>
  );
}

function CandidateCard({ candidate, selected, onSelect }) {
  const officeLabel = candidate.race.office === "house"
    ? "U.S. Representative"
    : "U.S. Senator";

  return (
    <button type="button" className={`election-candidate-card ${selected ? "is-selected" : ""}`}
      data-candidacy-id={candidate.candidacyId} aria-pressed={selected}
      aria-label={`${candidate.name}, ${officeLabel}, ${locationFor(candidate)}${candidate.incumbency === "incumbent" ? ", incumbent" : ""}`}
      onClick={() => onSelect(candidate.candidacyId)}>
      <CandidatePortrait candidate={candidate} />
      <h3 className="election-candidate-name">{candidate.name}</h3>
      {candidate.incumbency === "incumbent" && (
        <span className="election-incumbent-badge">Incumbent</span>
      )}
      <div className="election-candidate-office">
        {candidate.race.office === "house"
          ? <Building2 size={16} aria-hidden="true" />
          : <Landmark size={16} aria-hidden="true" />}
        <span>{officeLabel}</span>
      </div>
      <p className="election-candidate-location">{locationFor(candidate)}</p>
      <p className="election-candidate-party">
        <span className={`election-party-dot election-party-dot-${partyColor(candidate.party)}`}
          aria-hidden="true" />
        <span>{candidate.party || "Party unavailable"}</span>
      </p>
    </button>
  );
}

export default function ElectionCandidateNavigation({
  chamber,
  onChamberChange,
  roster,
  rosterStatus,
  rosterError,
  onRetry,
  emptyMessage,
  selectedCandidacyId = null,
  onSelectCandidate = () => {},
}) {
  function handleTabKeyDown(event, index) {
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % CHAMBER_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index + CHAMBER_TABS.length - 1) % CHAMBER_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CHAMBER_TABS.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextTab = CHAMBER_TABS[nextIndex];
    onChamberChange(nextTab.value);
    event.currentTarget.parentElement
      .querySelectorAll('[role="tab"]')[nextIndex]
      ?.focus();
  }

  return (
    <section className="election-candidate-navigation" aria-label="Election candidates">
      <div className="election-chamber-tabs" role="tablist" aria-label="Filter candidates by chamber">
        {CHAMBER_TABS.map(({ value, label }, index) => (
          <button
            key={value}
            type="button"
            id={`elections-chamber-tab-${value}`}
            role="tab"
            aria-selected={chamber === value}
            aria-controls="elections-candidate-roster"
            tabIndex={chamber === value ? 0 : -1}
            className="election-chamber-tab"
            onClick={() => onChamberChange(value)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id="elections-candidate-roster"
        className="election-candidate-roster"
        role="tabpanel"
        aria-labelledby={`elections-chamber-tab-${chamber}`}
        tabIndex={0}
      >
        {rosterStatus === "loading" && (
          <p className="election-roster-status" role="status">Loading candidates…</p>
        )}
        {rosterStatus === "error" && (
          <div className="election-roster-error" role="alert">
            <p>{rosterError}</p>
            <button type="button" className="election-roster-retry" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
        {rosterStatus === "unavailable" && (
          <p className="election-roster-status" role="status">
            Candidate information is not available yet.
          </p>
        )}
        {rosterStatus === "ready" && roster.length === 0 && (
          <p className="election-roster-status" role="status">{emptyMessage}</p>
        )}
        {rosterStatus === "ready" && roster.length > 0 && (
          <div className="election-candidate-grid">
            {roster.map((candidate) => (
              <CandidateCard key={candidate.candidacyId} candidate={candidate}
                selected={candidate.candidacyId === selectedCandidacyId}
                onSelect={onSelectCandidate} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
