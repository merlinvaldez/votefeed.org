import { useEffect, useId, useState } from "react";
import { Globe, IdCard, MapPin, Users, Landmark, Building2, ThumbsUp, ThumbsDown } from "lucide-react";
import "./RepCard.css";
import useCardDelegation from "./useCardDelegation";
import { partyPortraitColor } from "./memberPortrait";
import { selectCardAlignment } from "./voteInteractions";
import { availableCardChambers, selectAvailableCardChamber } from "./cardMembers";

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

const getPartyMemberLabel = (party) => {
  if (!party) return "Party unavailable";
  const name = party.trim().replace(/\s+Party$/i, "");
  const labels = {
    democratic: "Democrat",
    democrat: "Democrat",
    republican: "Republican",
    independent: "Independent",
    libertarian: "Libertarian",
    green: "Green",
  };
  return labels[name.toLowerCase()] ?? name;
};

function MemberSummary({ member, showChamber }) {
  const [failedPortrait, setFailedPortrait] = useState(null);
  return (
    <article className="member-card-row" aria-label={member.name}>
      <div className="member-avatar" style={{ borderColor: partyPortraitColor(member.party) }}>
        {member.portrait && failedPortrait !== member.portrait ? (
          <img className="member-avatar-image" src={member.portrait}
            alt={`${member.name} official portrait`} onError={() => setFailedPortrait(member.portrait)} />
        ) : <span className="member-avatar-fallback">{getRepInitials(member.name)}</span>}
      </div>
      <div className="member-copy">
        <h3 className="member-name">{member.name}</h3>
        <p className="member-mobile-summary">
          {showChamber && <>{member.chamber === "Senate" ? "Senator" : "Representative"} &middot; </>}
          {getPartyMemberLabel(member.party)}
          <br />{member.state}{member.chamber === "House" && member.district != null ? ` - District ${member.district}` : ""}
        </p>
        <div className="member-meta">
          {showChamber && <span className="meta-line"><IdCard className="meta-icon" aria-hidden="true" />
            {member.chamber === "Senate" ? "U.S. Senator" : "U.S. Representative"}</span>}
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
  alignmentPolicyArea = null, alignmentError = "", chamber, onChamberChange,
}) {
  const [localTab, setLocalTab] = useState("All Reps");
  const setSelectedTab = value => { setLocalTab(value); onChamberChange?.(value); };
  const cardId = useId();
  const { houseMember, senators, delegationLoading, delegationError } = useCardDelegation(rep, location);
  const available = availableCardChambers({ houseMember, senators,
    houseLoading: rep === undefined, delegationLoading, delegationError });
  const tabs = CARD_TABS.filter(tab => available.includes(tab.value));
  const requestedTab = chamber ?? localTab;
  const selectedTab = selectAvailableCardChamber(available, requestedTab);
  const emptyDelegation = available.length === 0;
  const showTabs = available.length > 1;
  if (chamber === undefined && localTab !== selectedTab) setLocalTab(selectedTab);
  // Keep the parent feed filter in sync if a location change removes its tab.
  useEffect(() => {
    if (chamber !== undefined && chamber !== selectedTab) onChamberChange?.(selectedTab);
  }, [chamber, selectedTab, onChamberChange]);
  const members = [houseMember, ...senators].filter(member => member &&
    (selectedTab === "All Reps" || member.chamber === selectedTab));
  const includesSenate = selectedTab !== "House";
  const alignment = selectCardAlignment(alignmentData, selectedTab);
  const alignmentPercent = Math.max(0, Math.min(100, alignment?.percent ?? 0));
  const alignmentColor = getAlignmentColor(alignmentPercent);

  function handleTabKey(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    setSelectedTab(tabs[next].value);
    event.currentTarget.parentElement.children[next].focus();
  }

  return (
    <section className="member-card" data-chamber={selectedTab} aria-label="Your congressional delegation">
      {showTabs && <div className="member-card-tabs" role="tablist" aria-label="Delegation chamber">
        {tabs.map(({ value, label, icon }, index) => (
          <button key={value} type="button" role="tab" id={`${cardId}-tab-${value}`}
            aria-controls={`${cardId}-panel`} aria-selected={selectedTab === value}
            tabIndex={selectedTab === value ? 0 : -1}
            onClick={() => setSelectedTab(value)} onKeyDown={event => handleTabKey(event, index)}>
            {icon}<span className={value === "House" ? "member-tab-full" : undefined}>{label}</span>
            {value === "House" && <span className="member-tab-short">House</span>}
          </button>
        ))}
      </div>}
      <div className={`member-card-body${members.length === 1 ? " member-card-single" : ""}`} role={showTabs ? "tabpanel" : undefined} id={`${cardId}-panel`}
        aria-labelledby={showTabs ? `${cardId}-tab-${selectedTab}` : undefined} tabIndex={showTabs ? 0 : undefined}>
        <div className="member-delegation">
          <div className="member-list">
            {members.map(member => <MemberSummary key={member.bioguideId} member={member} showChamber={!showTabs || selectedTab === "All Reps"} />)}
          </div>
          <div className="member-delegation-status" role="status">
            {emptyDelegation && <p>No current congressional members found for this location.</p>}
            {includesSenate && delegationLoading && <p>Loading Senators...</p>}
            {includesSenate && delegationError && <p>Unable to load Senators. Your other member details are still available.</p>}
            {!emptyDelegation && selectedTab !== "Senate" && !houseMember && rep !== undefined && <p>No current House member found for this district.</p>}
            {!emptyDelegation && includesSenate && !delegationLoading && !delegationError && senators.length === 0 &&
              <p>No current Senators found for this state.</p>}
          </div>
        </div>
      {!emptyDelegation && (
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
