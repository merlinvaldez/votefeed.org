import { getVotePosition } from "./votePosition";
import { memberLastName } from "./billDetailContext";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { partyPortraitColor } from "./memberPortrait";
import { voteResultPresentation } from "./voteResult";

function MemberVote({ member, position }) {
  const [failedPortrait, setFailedPortrait] = useState(null);
  const initials = member.name?.trim().split(/\s+/).map(part => part[0]).filter(Boolean);
  return <div className="bill-member-vote">
    <div className="bill-vote-portrait" style={{ borderColor: partyPortraitColor(member.party) }}>
      {member.portrait && failedPortrait !== member.portrait ?
        <img src={member.portrait} alt={`${member.name} official portrait`}
          onError={() => setFailedPortrait(member.portrait)} /> :
        <span aria-hidden="true">{initials?.length ? `${initials[0]}${initials.length > 1 ? initials.at(-1) : ""}` : "?"}</span>}
    </div>
    <div className="vote-result-block">
      <div className="vote-result-label">{member.chamber === "Senate" ? "Sen." : "Rep."} {memberLastName(member.name)} Voted</div>
      <span className={`pill vote-result-pill ${getVotePosition(position).className}`}>{position}</span>
    </div>
  </div>;
}

export default function BillVoteFolders({ tabs, selected, onSelect, disabled }) {
  const current = tabs.find(tab => tab.id === selected);
  const panelId = "bill-votes-panel";
  function onKeyDown(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === undefined || disabled) return;
    event.preventDefault();
    onSelect(tabs[next].id);
    event.currentTarget.parentElement.children[next].focus();
  }
  return <section className="bill-vote-folder">
    <div className="bill-folder-tabs" role="tablist" aria-label="Recorded votes by representative">
      {tabs.map((tab, index) => <button key={tab.id} id={`bill-folder-${tab.id.replaceAll(" ", "-")}`}
        type="button" role="tab" aria-selected={selected === tab.id} aria-controls={panelId}
        tabIndex={selected === tab.id ? 0 : -1} disabled={disabled}
        onClick={() => onSelect(tab.id)} onKeyDown={event => onKeyDown(event, index)}>{tab.label}</button>)}
    </div>
    <div className="bill-folder-panel" id={panelId} role="tabpanel"
      aria-labelledby={`bill-folder-${selected.replaceAll(" ", "-")}`} tabIndex={0}>
      {!current?.cards.length && <p>No eligible recorded vote is available for this chamber on this bill.</p>}
      {current?.cards.map(card => {
        const yes = card.result?.yes_count;
        const no = card.result?.no_count;
        const total = Number(yes) + Number(no);
        const result = voteResultPresentation(card.result?.result);
        const ResultIcon = result.outcome === "failed" ? XCircle : CheckCircle2;
        return <div className="vote-result-card" key={card.id}>
          <div className="vote-result-grid">
            {card.members.map(member => <MemberVote key={member.bioguideId} member={member} position={card.position} />)}
            <div className="vote-result-block"><div className="vote-result-label">Result</div>
              <span className={`pill vote-result-pill bill-outcome-pill ${result.className}`}>{result.outcome && <ResultIcon size={14} aria-hidden="true" />}{result.label}</span></div>
            <div className="vote-result-block vote-result-counts"><div className="vote-result-label">Vote Counts</div>
              {card.result && yes != null && no != null ? <>
                <div className="vote-count-bar" aria-hidden="true"><span className="vote-count-bar-yes" style={{ width: `${total ? yes / total * 100 : 0}%` }} />
                  <span className="vote-count-bar-no" style={{ width: `${total ? no / total * 100 : 0}%` }} /></div>
                <div className="vote-count-row"><span className="vote-count-yes">{yes} Yea</span><span className="vote-count-no">{no} Nay</span></div>
              </> : <span>Unavailable for this roll call</span>}
            </div>
          </div>
        </div>;
      })}
    </div>
  </section>;
}
