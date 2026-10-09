import { useId, useState } from "react";
import { Globe, IdCard, MapPin, Users, Landmark, Building2, ThumbsUp, ThumbsDown } from "lucide-react";
import "./RepCard.css";
import useCardDelegation from "./useCardDelegation";
import { selectCardAlignment } from "./voteInteractions";

const getRepInitials = (fullName = "") => {
  const normalized = fullName.trim();
  if (!normalized) return "US";
  const parts = normalized.split(/[\s,]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
};

const getAlignmentColor = (percent) => {
  if (percent >= 67) return "#16a34a";
  if (percent >= 40) return "#d97706";
  return "#dc2626";
};

function AlignmentGauge({ percent, hasData }) {
  const angle = Math.PI * percent / 100;
  const targetX = 120 - 84 * Math.cos(angle);
  const targetY = 110 - 84 * Math.sin(angle);
  return (
    <div className="member-alignment-chart">
      <svg viewBox="0 0 240 130" role="img" aria-label={hasData ? `Policy alignment: ${percent}%` : "No alignment data yet"}>
        <path d="M 20 110 A 100 100 0 0 1 220 110" pathLength="100" className="member-gauge-track" />
        <path d="M 20 110 A 100 100 0 0 1 220 110" pathLength="100"
          strokeDasharray={`${percent} 100`} className="member-gauge-value" />
        <line x1="120" y1="100" x2={targetX} y2={targetY - 10} className="member-gauge-needle" />
        <circle cx="120" cy="100" r="7" className="member-gauge-pivot" />
      </svg>
      <div className="member-alignment-percent" aria-hidden="true">{percent}%</div>
    </div>
  );
}

const CARD_TABS = [
  { value: "All Reps", label: "All Reps", icon: <Users size={22} aria-hidden="true" /> },
  { value: "House", label: "House of Representatives", icon: <Building2 size={22} aria-hidden="true" /> },
  { value: "Senate", label: "Senate", icon: <Landmark size={22} aria-hidden="true" /> },
];

function MemberSummary({ member }) {
  const [failedPortrait, setFailedPortrait] = useState(null);
  return (
    <article className="member-card-row" aria-label={member.name}>
      <div className="member-avatar">
        {member.portrait && failedPortrait !== member.portrait ? (
          <img className="member-avatar-image" src={member.portrait}
            alt={`${member.name} official portrait`} onError={() => setFailedPortrait(member.portrait)} />
        ) : <span className="member-avatar-fallback">{getRepInitials(member.name)}</span>}
      </div>
      <div className="member-copy">
        <h3 className="member-name">{member.name}</h3>
        <p className="member-mobile-summary">
          {member.chamber === "Senate" ? "Senator" : "Representative"} &middot; {member.party ?? "Party unavailable"}
          <br />{member.state}{member.chamber === "House" && member.district != null ? ` - District ${member.district}` : ""}
        </p>
        <div className="member-meta">
          <span className="meta-line"><IdCard className="meta-icon" aria-hidden="true" />
            {member.chamber === "Senate" ? "U.S. Senator" : "U.S. Representative"}</span>
          <span className="meta-line"><span className="meta-dot" aria-hidden="true" />
            {member.party ? `${member.party}${member.party.endsWith("Party") ? "" : " Party"}` : "Party unavailable"}</span>
          <span className="meta-line member-location"><MapPin className="meta-icon" aria-hidden="true" />
            {member.state}{member.chamber === "House" && member.district != null ? ` District ${member.district}` : ""}</span>
          {/^https?:\/\//i.test(member.officialWebsite ?? "") && (
            <a className="meta-line member-website-link" href={member.officialWebsite}
              target="_blank" rel="noreferrer" aria-label={`${member.name} official website (opens in a new tab)`}>
              <Globe className="meta-icon" aria-hidden="true" /><span className="member-website-label">Website</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function RepCard({
  rep, location = null, alignment: alignmentData,
  alignmentPolicyArea = null, alignmentError = "",
}) {
  const [selectedTab, setSelectedTab] = useState("All Reps");
  const cardId = useId();
  const { houseMember, senators, delegationLoading, delegationError } = useCardDelegation(rep, location);
  const members = [houseMember, ...senators].filter(member => member &&
    (selectedTab === "All Reps" || member.chamber === selectedTab));
  const includesSenate = selectedTab !== "House";
  const alignment = selectCardAlignment(alignmentData, selectedTab);
  const alignmentPercent = Math.max(0, Math.min(100, alignment?.percent ?? 0));
  const alignmentColor = getAlignmentColor(alignmentPercent);

  function handleTabKey(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % CARD_TABS.length;
    if (event.key === "ArrowLeft") next = (index + CARD_TABS.length - 1) % CARD_TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = CARD_TABS.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    setSelectedTab(CARD_TABS[next].value);
    event.currentTarget.parentElement.children[next].focus();
  }

  return (
    <section className="member-card" data-chamber={selectedTab} aria-label="Your congressional delegation">
      <div className="member-card-tabs" role="tablist" aria-label="Delegation chamber">
        {CARD_TABS.map(({ value, label, icon }, index) => (
          <button key={value} type="button" role="tab" id={`${cardId}-tab-${value}`}
            aria-controls={`${cardId}-panel`} aria-selected={selectedTab === value}
            tabIndex={selectedTab === value ? 0 : -1}
            onClick={() => setSelectedTab(value)} onKeyDown={event => handleTabKey(event, index)}>
            {icon}<span className={value === "House" ? "member-tab-full" : undefined}>{label}</span>
            {value === "House" && <span className="member-tab-short">House</span>}
          </button>
        ))}
      </div>
      <div className={`member-card-body${members.length === 1 ? " member-card-single" : ""}`} role="tabpanel" id={`${cardId}-panel`}
        aria-labelledby={`${cardId}-tab-${selectedTab}`} tabIndex={0}>
        <div className="member-delegation">
          <div className="member-list">
            {members.map(member => <MemberSummary key={member.bioguideId} member={member} />)}
          </div>
          <div className="member-delegation-status" role="status">
            {includesSenate && delegationLoading && <p>Loading Senators...</p>}
            {includesSenate && delegationError && <p>Unable to load Senators. Your other member details are still available.</p>}
            {selectedTab !== "Senate" && !houseMember && <p>No current House member found for this district.</p>}
            {includesSenate && !delegationLoading && !delegationError && senators.length === 0 &&
              <p>No current Senators found for this state.</p>}
          </div>
        </div>
      {(
        <div
          className="member-alignment"
          style={{ "--alignment-accent": alignmentColor }}
        >
          {alignmentError ? (
            <p className="member-alignment-empty" role="alert">{alignmentError}</p>
          ) : (
          <>
          <AlignmentGauge percent={alignmentPercent} hasData={Boolean(alignment?.hasData)} />
          <div className="member-alignment-text">
          <div className="member-alignment-label">Policy Alignment</div>
          <p className="member-alignment-copy">
            {alignment?.hasData ? <>
              You agree on <span className="member-alignment-emphasis">{alignment.agreementCount}</span>
              {" "}out of {alignment.comparableCount} votes
              {alignmentPolicyArea ? ` in ${alignmentPolicyArea}` : ""}
            </> : <>
              Select <ThumbsUp className="member-prompt-icon" role="img" aria-label="like" />
              {" or "}<ThumbsDown className="member-prompt-icon" role="img" aria-label="dislike" />
              {" on a vote to show alignment."}
            </>}
          </p>
          </div>
          </>
          )}
        </div>
      )}
      </div>
    </section>
  );
}
