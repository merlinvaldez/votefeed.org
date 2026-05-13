import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "./Feed.css";
import "./BillPage.css";
import {
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  Clock3,
  Copy,
  FileText,
  ExternalLink,
  Info,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  MessageSquare,
} from "lucide-react";
import { API_BASE } from "./constants";
import { useAuth } from "./AuthContext";

const getRepLastName = (fullName = "") => {
  const normalized = fullName.trim();
  if (!normalized) return "";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim();
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

const getVotePillClass = (voteVal) => {
  if (!voteVal || voteVal === "Not Voting") return "neutral";
  if (voteVal === "Yea" || voteVal === "Aye") return "success";
  if (voteVal === "No" || voteVal === "Nay") return "danger";
  return "neutral";
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
  };
  return `${labels[normalized] || normalized.toUpperCase()} ${number}`;
};

const formatLegislationReference = (type, number) => {
  const normalized = String(type || "hr").toLowerCase();
  const labels = {
    hr: "house bill",
    hres: "house resolution",
    hjres: "house joint resolution",
    hconres: "house concurrent resolution",
  };
  return `${labels[normalized] || "legislation"} ${number}`;
};

const formatDistrictLabel = (state, district) => {
  if (!state || district == null) return "your district";
  return `${state} District ${district}`;
};

const buildRepContactUrl = (websiteUrl) => {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    const lowerPath = normalizedPath.toLowerCase();
    url.pathname = !normalizedPath
      ? "/contact"
      : lowerPath.endsWith("/contact")
        ? normalizedPath
        : `${normalizedPath}/contact`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const getDialHref = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits ? `tel:${digits}` : null;
};

const copyTextToClipboard = async (text) => {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error("Copy failed");
  }
};

export default function BillPage() {
  const navigate = useNavigate();
  const { billType, billNumber } = useParams();
  const { state } = useLocation();
  const [rep, setRep] = useState(state?.rep ?? null);
  const repFullName = rep?.full_name ?? "";
  const repLastName = getRepLastName(repFullName);
  const { token, authFetch } = useAuth();
  const isAuthed = Boolean(token);
  const guestBarRef = useRef(null);
  const guestHighlightTimeoutRef = useRef(null);
  const copyNoticeTimeoutRef = useRef(null);
  const [bill, setBill] = useState(state?.bill || state?.vote || null);
  const [status, setStatus] = useState(bill ? "ready" : "loading");
  const [error, setError] = useState("");
  const [stance, setStance] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const [ownedCommentId, setOwnedCommentId] = useState(null);
  const [commentDraftText, setCommentDraftText] = useState("");
  const [commentModerationStatus, setCommentModerationStatus] = useState(null);
  const [isCommentPublic, setIsCommentPublic] = useState(false);
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [isSavingCommentDraft, setIsSavingCommentDraft] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [userState, setUserState] = useState("");
  const [userDistrict, setUserDistrict] = useState(null);
  const [interactionError, setInteractionError] = useState("");
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [messageCopyStatus, setMessageCopyStatus] = useState("idle");

  const [aiToggled, setAiToggled] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const billId = bill?.bill_id ?? bill?.id ?? null;
  const fullBillUrl = bill?.legislation_url ?? null;
  const canReadFullBill = Boolean(fullBillUrl);
  const latestVoteDate = bill?.latest_vote_date ?? bill?.voted_on ?? null;
  const voteYesCount = Number(bill?.vote_yes_count ?? 0);
  const voteNoCount = Number(bill?.vote_no_count ?? 0);
  const totalCountedVotes = voteYesCount + voteNoCount;
  const yesVotePercent =
    totalCountedVotes > 0 ? (voteYesCount / totalCountedVotes) * 100 : 0;
  const voteResultPillClass =
    bill?.vote_result === "Passed"
      ? "success"
      : bill?.vote_result === "Failed"
        ? "danger"
        : "neutral";
  const repVotePillClass = getVotePillClass(bill?.vote);
  const VoteResultIcon =
    bill?.vote_result === "Failed" ? XCircle : CheckCircle2;
  const currentStance = interaction?.stance ?? stance;
  const billLabel = formatBillLabel(
    bill?.legislation_type ?? bill?.bill_type,
    bill?.legislationnumber ?? bill?.number ?? billNumber,
  );
  const legislationReference = formatLegislationReference(
    bill?.legislation_type ?? bill?.bill_type ?? billType,
    bill?.legislationnumber ?? bill?.number ?? billNumber,
  );
  const districtLabel = formatDistrictLabel(userState, userDistrict);
  const repReference = repFullName
    ? `Rep. ${repLastName || repFullName}`
    : "my representative";
  const positionVerb = currentStance === "approve" ? "agree" : "disagree";
  const repContactUrl = buildRepContactUrl(rep?.official_website_url);
  const repDialHref = getDialHref(rep?.office_phone);
  const actionUserName = userName || "[Your Name]";
  const callScript = currentStance
    ? `Hello, my name is ${actionUserName}, and I'm a constituent from ${districtLabel}.\n\nI'm calling about ${legislationReference}.\n\nI ${positionVerb} with ${repReference}'s position because [state your reason]. Please share my view with the Representative.\n\nThank you.`
    : "";
  const messageTemplate = currentStance
    ? `Hello,\n\nMy name is ${actionUserName}, and I'm a constituent from ${districtLabel}.\n\nI'm reaching out about ${legislationReference}.\n\nI ${positionVerb} with ${repReference}'s position because [add your reason here].\n\nThank you for your time.`
    : "";

  useEffect(() => {
    return () => {
      window.clearTimeout(guestHighlightTimeoutRef.current);
      window.clearTimeout(copyNoticeTimeoutRef.current);
    };
  }, []);

  const promptGuestInteraction = () => {
    if (isAuthed) return false;
    guestBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setInteractionError("");
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

  const handleToggleAi = async (nextValue) => {
    setAiToggled(nextValue);
    if (!nextValue) return;
    if (aiSummary) return;
    setAiLoading(true);
    setAiError("");
    try {
      const resp = await fetch(
        `${API_BASE}/bills/${billType}/${billNumber}/ai-summary`,
      );
      if (!resp.ok) throw new Error("AI summary failed");
      const data = await resp.json();
      setAiSummary(data.aiSummary);
    } catch {
      setAiError("AI summary failed");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (bill) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading");
        const resp = await fetch(`${API_BASE}/bills/${billType}/${billNumber}`);
        if (!resp.ok) throw new Error(`Bill load failed (${resp.status})`);
        const data = await resp.json();
        if (!cancelled) {
          setBill(data);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load bill");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bill, billNumber, billType]);

  useEffect(() => {
    if (!token || !billId) return;
    let cancelled = false;

    (async () => {
      try {
        setInteractionError("");
        const meResp = await authFetch(`${API_BASE}/users/me`);
        if (!meResp.ok) throw new Error("Failed to load user");
        const me = await meResp.json();
        if (!cancelled) setUserId(me.id);
        if (!cancelled)
          setUserName(`${me.first_name || ""} ${me.last_name || ""}`.trim());
        if (!cancelled) setUserState(me.state || "");
        if (!cancelled) setUserDistrict(me.district ?? null);

        if (
          (!state?.rep ||
            !state?.rep?.official_website_url ||
            !state?.rep?.office_phone) &&
          me.state &&
          me.district != null
        ) {
          const repResp = await authFetch(
            `${API_BASE}/reps/district/${me.state}/${me.district}`,
          );
          if (repResp.ok) {
            const repData = await repResp.json();
            if (!cancelled) setRep(repData);
          }
        }

        const interactionResp = await authFetch(
          `${API_BASE}/interactions/users/${me.id}/bill/${billId}`,
        );
        if (!interactionResp.ok) throw new Error("Failed to load interaction");
        const text = await interactionResp.text();
        const data = text ? JSON.parse(text) : null;
        if (!cancelled) setInteraction(data || null);
      } catch (err) {
        if (!cancelled)
          setInteractionError(err.message || "Failed to load interaction");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, billId, authFetch]);

  useEffect(() => {
    setStance(interaction?.stance || null);
  }, [interaction]);

  useEffect(() => {
    setOwnedCommentId(interaction?.comment_id ?? null);
    setCommentDraftText(interaction?.comment_draft_text ?? "");
    setCommentModerationStatus(interaction?.comment_moderation_status ?? null);
    setIsCommentPublic(Boolean(interaction?.comment_is_public));
  }, [interaction]);

  useEffect(() => {
    if (!currentStance) {
      setSelectedAction(null);
    }
  }, [currentStance]);

  useEffect(() => {
    if (!interaction?.id) {
      setIsCommentComposerOpen(false);
    }
  }, [interaction?.id]);

  useEffect(() => {
    if (selectedAction === "message") return;
    window.clearTimeout(copyNoticeTimeoutRef.current);
    setMessageCopyStatus("idle");
  }, [selectedAction]);

  const toggleSelectedAction = (nextAction) => {
    setSelectedAction((currentAction) =>
      currentAction === nextAction ? null : nextAction,
    );
  };

  const handleCopyMessage = async () => {
    if (!messageTemplate) return;

    try {
      await copyTextToClipboard(messageTemplate);
      setMessageCopyStatus("success");
    } catch {
      setMessageCopyStatus("error");
    }

    window.clearTimeout(copyNoticeTimeoutRef.current);
    copyNoticeTimeoutRef.current = window.setTimeout(() => {
      setMessageCopyStatus("idle");
    }, 1800);
  };

  const mergeCommentIntoInteraction = (currentInteraction, savedComment) =>
    currentInteraction
      ? {
          ...currentInteraction,
          comment_id: savedComment.id ?? null,
          comment_draft_text: savedComment.draft_text ?? "",
          comment_approved_text: savedComment.approved_text ?? null,
          comment_moderation_status: savedComment.moderation_status ?? "draft",
          comment_moderation_reason: savedComment.moderation_reason ?? null,
          comment_moderation_categories:
            savedComment.moderation_categories ?? null,
          comment_is_public: Boolean(savedComment.is_public),
          comment_last_submitted_at: savedComment.last_submitted_at ?? null,
          comment_last_moderated_at: savedComment.last_moderated_at ?? null,
          comment_published_at: savedComment.published_at ?? null,
          comment_updated_at: savedComment.updated_at ?? null,
        }
      : currentInteraction;

  const persistCommentDraft = async () => {
    const resp = await authFetch(`${API_BASE}/interactions/${interaction.id}/comment`, {
      method: "PUT",
      body: JSON.stringify({ draft_text: commentDraftText }),
    });
    if (!resp.ok) throw new Error("Failed to save draft comment");
    const savedDraft = await resp.json();
    setInteraction((currentInteraction) =>
      mergeCommentIntoInteraction(currentInteraction, savedDraft),
    );
    return savedDraft;
  };

  const handleSaveCommentDraft = async () => {
    if (!interaction?.id) return;
    if (!commentDraftText.trim()) return;

    try {
      setInteractionError("");
      setIsSavingCommentDraft(true);
      await persistCommentDraft();
    } catch (err) {
      setInteractionError(err.message || "Failed to save draft comment");
    } finally {
      setIsSavingCommentDraft(false);
    }
  };

  const handleSubmitCommentForModeration = async () => {
    if (!interaction?.id) return;
    if (!commentDraftText.trim()) return;

    try {
      setInteractionError("");
      setIsSubmittingComment(true);
      const currentSavedDraft = interaction?.comment_draft_text?.trim() ?? "";
      if (commentDraftText.trim() !== currentSavedDraft || !ownedCommentId) {
        await persistCommentDraft();
      }
      const resp = await authFetch(
        `${API_BASE}/interactions/${interaction.id}/comment/submit`,
        {
          method: "POST",
        },
      );
      if (!resp.ok) throw new Error("Failed to submit comment for moderation");
      const moderatedComment = await resp.json();
      setInteraction((currentInteraction) =>
        mergeCommentIntoInteraction(currentInteraction, moderatedComment),
      );
    } catch (err) {
      setInteractionError(
        err.message || "Failed to submit comment for moderation",
      );
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleStanceClick = async (nextStance) => {
    if (!token) {
      promptGuestInteraction();
      return;
    }
    if (!billId) return;
    if (!rep?.bioguideid) {
      setInteractionError(
        "Loading your representative details. Try again in a moment.",
      );
      return;
    }

    try {
      setInteractionError("");
      if (interaction?.stance === nextStance) {
        const resp = await authFetch(
          `${API_BASE}/interactions/${interaction.id}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error("Failed to delete stance");
        setInteraction(null);
        return;
      }

      const resp = await authFetch(
        interaction
          ? `${API_BASE}/interactions/${interaction.id}/stance`
          : `${API_BASE}/interactions/addstance`,
        {
          method: interaction ? "PUT" : "POST",
          body: JSON.stringify(
            interaction
              ? { stance: nextStance }
              : {
                  user_id: userId,
                  bill_id: billId,
                  rep_bioguide_id: rep.bioguideid,
                  stance: nextStance,
                },
          ),
        },
      );
      if (!resp.ok) throw new Error("Failed to save stance");
      const saved = await resp.json();
      setInteraction(saved);
    } catch (err) {
      setInteractionError(err.message || "Failed to save stance");
    }
  };
  const showAi = aiToggled;

  return (
    <>
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={18}></ArrowLeft> Back to Feed
      </button>
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
              <div className="guest-sub">Your interactions won't be saved.</div>
            </div>
          </div>
          <button className="guest-cta" onClick={() => navigate("/signup")}>
            Sign Up / Sign In
          </button>
        </div>
      )}
      <div className="leg-card">
        <div className="leg-top">
          <div className="leg-meta-row">
            <span className="pill primary">{billLabel}</span>
            {latestVoteDate && (
              <span className="leg-date">
                <Clock3 size={14}></Clock3>
                {formatVotedOn(latestVoteDate)}
              </span>
            )}
          </div>
          <label className="toggle toggle-ai" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(showAi)}
              onChange={(e) => handleToggleAi(e.target.checked)}
              aria-label="Toggle AI summary"
              title="Show simplified AI summary"
            />
          </label>
        </div>
        {status === "loading" && <p>Loading summary</p>}
        {status === "error" && <p className="error-text">{error}</p>}
        {!showAi && bill?.summary && (
          <div
            className="leg-body"
            dangerouslySetInnerHTML={{ __html: bill.summary }}
          ></div>
        )}
        {showAi && aiLoading && <div className="leg-body">Loading...</div>}
        {showAi && aiError && bill?.summary && (
          <div
            className="leg-body"
            dangerouslySetInnerHTML={{ __html: bill.summary }}
          ></div>
        )}
        {showAi && !aiLoading && !aiError && (
          <div className="leg-body">{aiSummary}</div>
        )}
        {showAi && aiError && <p className="error-text">{aiError}</p>}
        {bill?.vote_result && (
          <section className="vote-result-card">
            <div className="vote-result-grid">
              {bill?.vote && (
                <div className="vote-result-block">
                  <div className="vote-result-label">
                    Rep. {repLastName} Voted
                  </div>
                  <span className={`pill ${repVotePillClass} vote-result-pill`}>
                    {bill.vote}
                  </span>
                </div>
              )}
              <div className="vote-result-block">
                <div className="vote-result-label">Result</div>
                <span
                  className={`pill ${voteResultPillClass} vote-result-pill`}
                >
                  <VoteResultIcon size={14}></VoteResultIcon>
                  {bill.vote_result}
                </span>
              </div>
              <div className="vote-result-block vote-result-counts">
                <div className="vote-result-label">Vote Counts</div>
                <div className="vote-count-bar" aria-hidden="true">
                  <span
                    className="vote-count-bar-yes"
                    style={{ width: `${yesVotePercent}%` }}
                  ></span>
                  <span
                    className="vote-count-bar-no"
                    style={{ width: `${100 - yesVotePercent}%` }}
                  ></span>
                </div>
                <div className="vote-count-row">
                  <span className="vote-count-yes">{voteYesCount} Yea</span>
                  <span className="vote-count-no">{voteNoCount} Nay</span>
                </div>
              </div>
            </div>
          </section>
        )}
        {canReadFullBill && (
          <div className="bill-reference-row">
            <a
              className="bill-text-link"
              href={fullBillUrl}
              target="_blank"
              rel="noopener"
            >
              <span className="bill-text-link-copy">
                <FileText size={18}></FileText>
                <span>Read Full Bill Text</span>
              </span>
              <ExternalLink size={16}></ExternalLink>
            </a>
          </div>
        )}
        <div className="vote-actions">
          <button
            type="button"
            className={`ghost-btn ${
              currentStance === "approve" ? "active approve" : ""
            }`}
            onClick={() => handleStanceClick("approve")}
            aria-label={`Agree with ${repReference}`}
            aria-pressed={currentStance === "approve"}
            title={`Agree with ${repReference}`}
          >
            <ThumbsUp size={16} />
            {currentStance === "approve" && (
              <span>I agree with {repReference}</span>
            )}
          </button>
          <button
            type="button"
            className={`ghost-btn ${
              currentStance === "disapprove" ? "active disapprove" : ""
            }`}
            onClick={() => handleStanceClick("disapprove")}
            aria-label={`Disagree with ${repReference}`}
            aria-pressed={currentStance === "disapprove"}
            title={`Disagree with ${repReference}`}
          >
            <ThumbsDown size={16} />
            {currentStance === "disapprove" && (
              <span>I disagree with {repReference}</span>
            )}
          </button>
          {interaction?.id && (
            <button
              type="button"
              className={`ghost-btn ${isCommentComposerOpen ? "active" : ""}`}
              onClick={() =>
                setIsCommentComposerOpen((currentValue) => !currentValue)
              }
              aria-label={
                isCommentComposerOpen ? "Hide comment composer" : "Write comment"
              }
              aria-expanded={isCommentComposerOpen}
              aria-controls="bill-comment-composer"
              title="Write comment"
            >
              <MessageSquare size={16}></MessageSquare>
              {isCommentComposerOpen && <span>Comment</span>}
            </button>
          )}
          {currentStance && (
            <>
              <button
                type="button"
                className={`ghost-btn ${
                  selectedAction === "call" ? "active" : ""
                }`}
                onClick={() => toggleSelectedAction("call")}
                aria-label={
                  selectedAction === "call"
                    ? "Hide call script"
                    : "Show call script"
                }
                aria-expanded={selectedAction === "call"}
                aria-controls="bill-call-script-panel"
                title="Call script"
              >
                <Phone size={16}></Phone>
                {selectedAction === "call" && <span>Call</span>}
              </button>
              <button
                type="button"
                className={`ghost-btn ${
                  selectedAction === "message" ? "active" : ""
                }`}
                onClick={() => toggleSelectedAction("message")}
                aria-label={
                  selectedAction === "message"
                    ? "Hide message template"
                    : "Show message template"
                }
                aria-expanded={selectedAction === "message"}
                aria-controls="bill-message-template-panel"
                title="Message template"
              >
                <Mail size={16}></Mail>
                {selectedAction === "message" && <span>Message</span>}
              </button>
            </>
          )}
        </div>

        {interaction?.id && isCommentComposerOpen && (
          <section id="bill-comment-composer" className="comment-box">
            <div className="comment-ahead">
              <div className="comment-preview">Draft your comment</div>
            </div>
            <textarea
              value={commentDraftText}
              onChange={(event) => setCommentDraftText(event.target.value)}
              placeholder="Write what you think about this bill and why."
              aria-label="Comment draft"
            ></textarea>
            <div className="comment-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={handleSaveCommentDraft}
                disabled={
                  isSavingCommentDraft ||
                  isSubmittingComment ||
                  !commentDraftText.trim()
                }
              >
                {isSavingCommentDraft ? "Saving..." : "Save draft"}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSubmitCommentForModeration}
                disabled={
                  isSavingCommentDraft ||
                  isSubmittingComment ||
                  !commentDraftText.trim()
                }
              >
                {isSubmittingComment ? "Submitting..." : "Submit for review"}
              </button>
            </div>
            {commentModerationStatus === "blocked" &&
              interaction?.comment_moderation_reason && (
                <p className="error-text">
                  {interaction.comment_moderation_reason}
                </p>
              )}
          </section>
        )}

        {currentStance && selectedAction === "call" && (
          <section id="bill-call-script-panel" className="action-guide-card">
            {repDialHref ? (
              <a className="action-guide-inline-link" href={repDialHref}>
                <Phone size={16}></Phone>
                Call {repReference} at {rep.office_phone}
              </a>
            ) : (
              <span className="action-guide-inline-missing">
                <Phone size={16}></Phone>
                Call info unavailable for {repReference}
              </span>
            )}
            <pre className="action-guide-template">{callScript}</pre>
          </section>
        )}
        {currentStance && selectedAction === "message" && (
          <section
            id="bill-message-template-panel"
            className="action-guide-card"
          >
            {repContactUrl ? (
              <a
                className="action-guide-inline-link"
                href={repContactUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Mail size={16}></Mail>
                Message {repReference}
                <ExternalLink size={16}></ExternalLink>
              </a>
            ) : (
              <span className="action-guide-inline-missing">
                <Mail size={16}></Mail>
                Contact page unavailable for {repReference}
              </span>
            )}
            <div className="action-guide-template-wrap">
              <div className="action-guide-template-tools">
                <button
                  type="button"
                  className="template-copy-btn"
                  onClick={handleCopyMessage}
                  aria-label="Copy message template"
                  title="Copy message template"
                >
                  <Copy size={14}></Copy>
                </button>
                <span
                  className={`template-copy-status ${
                    messageCopyStatus === "success"
                      ? "success"
                      : messageCopyStatus === "error"
                        ? "error"
                        : ""
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {messageCopyStatus === "success"
                    ? "Copied to clipboard."
                    : messageCopyStatus === "error"
                      ? "Copy failed. Try again."
                      : ""}
                </span>
              </div>
              <pre className="action-guide-template action-guide-template-copyable">
                {messageTemplate}
              </pre>
            </div>
          </section>
        )}
        {interactionError && <p className="error-text">{interactionError}</p>}
      </div>
    </>
  );
}
