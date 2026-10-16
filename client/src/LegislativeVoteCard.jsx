import { useId } from "react";
import { cardMemberNames } from "./legislativeCardNames";
import "./LegislativeVoteCard.css";
import MemberPortrait from "./MemberPortraitAvatar.jsx";
import { summaryIdentity, hasSummaryText, summaryView } from "./feedSummaries";
import { getVotePosition } from "./votePosition";
import { getCardResponseTargets, getCardResponseState } from "./voteInteractions";
import { ThumbsUp, ThumbsDown, MessageCircle, Clock3, ScrollText } from "lucide-react";

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

export default function LegislativeVoteCard({ vote, interactions, isAuthed, stancePending, showOriginalByCard, aiLoadingByBill, aiSummaryByBill, aiErrorByBill, setShowOriginalByCard, loadAiSummary, goToBill, handleStance, handleCommentIntent }) {
  const targets = getCardResponseTargets(vote);
  const responseState = getCardResponseState(vote, interactions);
  const position = getVotePosition(vote.position ?? vote.vote, targets.length);
  const answeredStance = responseState.stance;
  const { title: memberTitle, surnames: repLastName, fullNames } = cardMemberNames(targets);
  const responseDescriptionId = useId();
  const hasResponseDescription = ["mixed", "partial"].includes(responseState.status);
  const isSaving = targets.some(member => Boolean(stancePending[member.memberVoteId]));
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
    <article className={`leg-card legislative-vote-card${vote.members.length === 2 ? " legislative-vote-card-pair" : ""}`} aria-label={`${memberTitle} ${fullNames}: ${billLabel}`} aria-busy={isSaving}>
      <div className="leg-card-content">
      <div className="leg-top">
        <div className="leg-meta-row">
          <div className="leg-member-portraits" role="group" aria-label={`${memberTitle} ${fullNames}`}>
            {vote.members.map(member => <MemberPortrait key={member.bioguideId} member={member} />)}
          </div>
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
      </div>
        {aiError && (
          <div className="error-text leg-summary-error">
            {aiError}
            <button 
              type="button" 
              onClick={() => loadAiSummary(vote, true)}
              className="leg-summary-retry"
            >
              Retry
            </button>
          </div>
        )}
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
      {view.showAction && <p className="response-status">
        {memberTitle} {repLastName} {position.verb}{position.label ? ` ${position.label}` : ""} on {billLabel}.
      </p>}
      {hasResponseDescription && (
        <p id={responseDescriptionId} className="response-status" role="status">
          {responseState.status === "mixed" ? "Mixed responses: " : "Partial response: "}
          {responseState.answers.map(answer =>
            `${answer.name || answer.memberId}: ${answer.stance === "approve" ? "Agree" : answer.stance === "disapprove" ? "Disagree" : "Unanswered"}`
          ).join("; ")}. Choosing a response applies to both Senators.
        </p>
      )}
      {responseState.invalid && <p className="error-text" role="alert">Some saved responses are invalid. Choose a response again or refresh.</p>}
      {isSaving && <p className="response-status" role="status">Saving response</p>}
      <div className="leg-actions">
        <button
          type="button"
          className={`ghost-btn ${
            answeredStance === "approve" ? "active approve" : ""
          }`}
          onClick={() => handleStance(vote, "approve")}
          disabled={responseDisabled}
          aria-label={`Agree with ${memberTitle} ${fullNames}`}
          aria-describedby={hasResponseDescription ? responseDescriptionId : undefined}
          aria-pressed={answeredStance === "approve"}
          title={`Click to record that you agree with how ${memberTitle} ${repLastName} voted on ${billLabel}.`}
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
          aria-label={`Disagree with ${memberTitle} ${fullNames}`}
          aria-describedby={hasResponseDescription ? responseDescriptionId : undefined}
          aria-pressed={answeredStance === "disapprove"}
          title={`Click to record that you disagree with how ${memberTitle} ${repLastName} voted on ${billLabel}.`}
        >
          <ThumbsDown size={16} />
          {answeredStance === "disapprove" && (
            <span>I disagree with {memberTitle} {repLastName}</span>
          )}
        </button>

        <button
          type="button"
          className="comments"
          aria-label={`Open comments on ${billLabel} for ${fullNames}`}
          disabled={targets.some(member => Boolean(stancePending[member.memberVoteId]))}
          onClick={() => handleCommentIntent(vote)}
          style={{ cursor: "pointer" }}
        >
          <MessageCircle size={16} />
          {Number.isSafeInteger(vote.publicCommentCount) && vote.publicCommentCount >= 0
            ? `${vote.publicCommentCount} ${vote.publicCommentCount === 1 ? "Comment" : "Comments"}`
            : "Comments"}
        </button>
      </div>
      </div>
    </article>
  );
}

