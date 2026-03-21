import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "./Feed.css";
import "./BillPage.css";
import {
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  ArrowLeft,
  Clock3,
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

export default function BillPage() {
  const navigate = useNavigate();
  const { billNumber } = useParams();
  const { state } = useLocation();
  const repFullName = state?.rep?.full_name ?? "";
  const repLastName = getRepLastName(repFullName);
  const { token, authFetch } = useAuth();
  const [bill, setBill] = useState(state?.bill || state?.vote || null);
  const [status, setStatus] = useState(bill ? "ready" : "loading");
  const [error, setError] = useState("");
  const [stance, setStance] = useState(null);
  const [comment, setComment] = useState("");
  const [interaction, setInteraction] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [interactionError, setInteractionError] = useState("");
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [isDraftDirty, setIsDraftDirty] = useState(false);

  const [aiToggled, setAiToggled] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const billId = bill?.bill_id ?? bill?.id ?? null;

  const handleToggleAi = async (nextValue) => {
    setAiToggled(nextValue);
    if (!nextValue) return;
    if (aiSummary) return;
    setAiLoading(true);
    setAiError("");
    try {
      const resp = await fetch(`${API_BASE}/bills/${billNumber}/ai-summary`);
      if (!resp.ok) throw new Error("AI summary failed");
      const data = await resp.json();
      setAiSummary(data.aiSummary);
    } catch (err) {
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
        const resp = await fetch(`${API_BASE}/bills/${billNumber}`);
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
  }, [bill, billNumber]);

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
    if (!isDraftDirty) {
      setComment(interaction?.user_comment || "");
    }
  }, [interaction, isDraftDirty]);

  const handleStanceClick = async (nextStance) => {
    if (!token) {
      setInteractionError("Log in to vote on bills.");
      return;
    }
    if (!billId) return;

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

  const handleCommentSave = async () => {
    if (!token) {
      setInteractionError("Log in to comment.");
      return;
    }
    if (!billId) return;

    try {
      setInteractionError("");
      let current = interaction;

      if (!stance && !interaction?.stance) {
        setInteractionError("Pick approve or disapprove first.");
        return;
      }

      if (!current) {
        const stanceResp = await authFetch(
          `${API_BASE}/interactions/addstance`,
          {
            method: "POST",
            body: JSON.stringify({
              user_id: userId,
              bill_id: billId,
              stance,
            }),
          },
        );
        if (!stanceResp.ok) throw new Error("Failed to create stance");
        current = await stanceResp.json();
        setInteraction(current);
      }

      const resp = await authFetch(
        `${API_BASE}/interactions/${current.id}/comment`,
        {
          method: "PUT",
          body: JSON.stringify({ user_comment: comment }),
        },
      );
      if (!resp.ok) throw new Error("Failed to save comment");
      const saved = await resp.json();
      setInteraction(saved);
      setIsEditingComment(false);
      setIsDraftDirty(false);
    } catch (err) {
      setInteractionError(err.message || "Failed to save comment");
    }
  };

  const handleCommentDelete = async () => {
    if (!interaction) return;
    try {
      setInteractionError("");
      const resp = await authFetch(
        `${API_BASE}/interactions/${interaction.id}/comment`,
        { method: "DELETE" },
      );
      if (!resp.ok) throw new Error("Failed to delete comment");
      const saved = await resp.json();
      setInteraction(saved);
      setComment("");
      setIsEditingComment(false);
      setIsDraftDirty(false);
    } catch (err) {
      setInteractionError(err.message || "Failed to delete comment");
    }
  };

  const hasComment = Boolean(interaction?.user_comment);
  const showCommentEditor = !hasComment || isEditingComment;
  const showAi = aiToggled;

  return (
    <>
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={18}></ArrowLeft> Back to Feed
      </button>
      <div className="leg-card">
        <div className="leg-top">
          <span className="pill primary">
            {formatBillLabel(
              bill?.legislation_type ?? bill?.bill_type,
              bill?.legislationnumber ?? bill?.number ?? billNumber,
            )}
          </span>
          {bill?.vote && (
            <span className={`pill ${getVotePillClass(bill.vote)}`}>
              Rep. {repLastName} Voted: {bill.vote}
            </span>
          )}
          {bill?.voted_on && (
            <span className="pill neutral">
              <Clock3 size={14}></Clock3>
              Voted On: {formatVotedOn(bill.voted_on)}
            </span>
          )}
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

        <div className="vote-actions">
          <button
            className={`ghost-btn ${
              stance === "approve" ? "active approve" : ""
            }`}
            onClick={() => handleStanceClick("approve")}
          >
            <ThumbsUp size={16} /> I agree with Rep. {repLastName}
          </button>
          <button
            className={`ghost-btn ${
              stance === "disapprove" ? "active disapprove" : ""
            }`}
            onClick={() => handleStanceClick("disapprove")}
          >
            <ThumbsDown size={16} /> I disagree with Rep. {repLastName}
          </button>
        </div>

        <div className="comment-box">
          {showCommentEditor && (
            <div className="comment-ahead">
              <div className="avatar">Me</div>
              <div className="comments">
                <MessageCircle size={16}> 0 Comments</MessageCircle>
              </div>
            </div>
          )}
          {hasComment && !isEditingComment && (
            <div className="comment-card">
              <div className="comment-label">{userName || "My comment"}</div>
              <div className="comment-text">{interaction.user_comment}</div>
            </div>
          )}
          {showCommentEditor && (
            <textarea
              placeholder="Write a comment to your Representative"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setIsDraftDirty(true);
              }}
            ></textarea>
          )}
          {interactionError && <p className="error-text">{interactionError}</p>}
          <div className="comment-actions">
            {showCommentEditor ? (
              <>
                <button className="primary-btn" onClick={handleCommentSave}>
                  {hasComment ? "Save Comment" : "Comment"}
                </button>
                {hasComment && (
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      setComment(interaction?.user_comment || "");
                      setIsEditingComment(false);
                      setIsDraftDirty(false);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="primary-btn"
                  onClick={() => setIsEditingComment(true)}
                >
                  Edit
                </button>
                <button className="ghost-btn" onClick={handleCommentDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
