import { useState } from "react";
import { partyPortraitColor } from "./memberPortrait";
import "./MemberPortrait.css";

export default function MemberPortrait({ member }) {
  const [failedSource, setFailedSource] = useState(null);
  const name = member.name?.trim() || member.bioguideId || "Unknown member";
  const initials = name.split(/[\s,]+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("");
  return (
    <span className="member-portrait" style={{ borderColor: partyPortraitColor(member.party) }}>
      {member.portrait && failedSource !== member.portrait ? (
        <img src={member.portrait} alt={`${name} official portrait`}
          onError={() => setFailedSource(member.portrait)} />
      ) : <span role="img" aria-label={`${name} initials`}>{initials}</span>}
    </span>
  );
}
