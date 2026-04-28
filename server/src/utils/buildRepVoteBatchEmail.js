const BILL_TYPE_LABELS = {
  hr: "H.R.",
  hres: "H.Res.",
  hjres: "H.J.Res.",
  hconres: "H.Con.Res.",
  s: "S.",
  sres: "S.Res.",
  sjres: "S.J.Res.",
  sconres: "S.Con.Res.",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRepLastName(repName = "") {
  const normalized = String(repName).trim();
  if (!normalized) return "Representative";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim() || "Representative";
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts.at(-1) ?? "Representative";
}

function getBillLabel(vote) {
  const typeKey = String(vote?.legislationType ?? "").trim().toLowerCase();
  const prefix = BILL_TYPE_LABELS[typeKey] ?? String(typeKey).toUpperCase();
  return `${prefix} ${vote?.legislationNumber}`;
}

function getVoteDisplayTitle(vote) {
  const billLabel = getBillLabel(vote);
  const typeKey = String(vote?.legislationType ?? "").trim().toLowerCase();
  if (typeKey.includes("res")) return billLabel;
  const title = String(vote?.billTitle ?? "").trim();
  return title || billLabel;
}

function getVotePillStyles(voteValue) {
  const normalizedVote = String(voteValue ?? "").trim();
  if (normalizedVote === "Yea" || normalizedVote === "Aye") {
    return {
      text: "#166534",
      background: "#ecfdf3",
      border: "#bbf7d0",
    };
  }
  if (normalizedVote === "Nay" || normalizedVote === "No") {
    return {
      text: "#b91c1c",
      background: "#fef2f2",
      border: "#fecdd3",
    };
  }
  return {
    text: "#374151",
    background: "#f3f4f6",
    border: "#e5e7eb",
  };
}

function buildVotePillHtml(voteValue) {
  const styles = getVotePillStyles(voteValue);
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid ${styles.border}; background: ${styles.background}; color: ${styles.text}; font-size: 13px; font-weight: 700; line-height: 1.4; white-space: nowrap;">${escapeHtml(voteValue)}</span>`;
}

export function buildRepVoteBatchEmail({ firstName, repName, votes = [] }) {
  if (!Array.isArray(votes) || votes.length === 0) {
    throw new Error("buildRepVoteBatchEmail requires at least one vote");
  }

  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
  const repLastName = getRepLastName(repName);
  const safeRepLastName = escapeHtml(repLastName);
  const safeFirstName = escapeHtml(firstName || "there");
  const loginUrl = new URL("/login", appOrigin).toString();
  const siteUrl = new URL("/", appOrigin).toString();
  const subject = `Here are Rep. ${repLastName}'s latest votes`;

  const itemsHtml = votes
    .map((vote) => {
      const displayTitle = getVoteDisplayTitle(vote);
      const votePillHtml = buildVotePillHtml(vote.vote);
      return `<li style="margin: 0 0 12px;">Rep. ${safeRepLastName} voted ${votePillHtml} on ${escapeHtml(displayTitle)}</li>`;
    })
    .join("");

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #0f172a; background: #ffffff;">
      <p>Hi ${safeFirstName},</p>
      <p>Here are Rep. ${safeRepLastName}'s latest votes,</p>
      <ul style="padding-left: 20px; margin: 0 0 20px;">
        ${itemsHtml}
      </ul>
      <p>Let Rep. ${safeRepLastName} know how you feel about their votes!</p>
      <p style="margin: 24px 0;">
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #1d4ed8; color: #ffffff; text-decoration: none; font-weight: 700;">Go to VoteFeed</a>
      </p>
      <p style="margin-top: 24px;">Stay Civic,<br /><a href="${siteUrl}" style="color: #1d4ed8; text-decoration: underline;">VoteFeed.org</a></p>
    </div>
  `.trim();

  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `Here are Rep. ${repLastName}'s latest votes,`,
    "",
    ...votes.map((vote) => {
      const displayTitle = getVoteDisplayTitle(vote);
      return `- Rep. ${repLastName} voted ${vote.vote} on ${displayTitle}`;
    }),
    "",
    `Let Rep. ${repLastName} know how you feel about their votes!`,
    `Go to VoteFeed: ${loginUrl}`,
    "",
    "Stay Civic,",
    `VoteFeed.org (${siteUrl})`,
  ].join("\n");

  return { subject, html, text };
}
