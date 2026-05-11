import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "./Feed.css";
import "./BillPage.css";
import {
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  Clock3,
  FileText,
  ExternalLink,
  Info,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Phone,
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
    url.pathname =
      !normalizedPath
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
  const [bill, setBill] = useState(state?.bill || state?.vote || null);
  const [status, setStatus] = useState(bill ? "ready" : "loading");
  const [error, setError] = useState("");
  const [stance, setStance] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [userState, setUserState] = useState("");
  const [userDistrict, setUserDistrict] = useState(null);
  const [interactionError, setInteractionError] = useState("");
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);

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
  const billReference = bill?.title ? `${billLabel}, ${bill.title}` : billLabel;
  const districtLabel = formatDistrictLabel(userState, userDistrict);
  const repReference = repFullName
    ? `Rep. ${repLastName || repFullName}`
    : "my representative";
  const positionVerb = currentStance === "approve" ? "agree" : "disagree";
  const repContactUrl = buildRepContactUrl(rep?.official_website_url);
  const repDialHref = getDialHref(rep?.office_phone);
  const actionUserName = userName || "[Your Name]";
  const callScript = currentStance
    ? `Hello, my name is ${actionUserName}, and I'm a constituent from ${districtLabel}.\n\nI'm calling about ${billReference}.\n\nI ${positionVerb} with ${repReference}'s position because [add your reason here]. Please share my view with the Representative.\n\nThank you.`
    : "";
  const messageTemplate = currentStance
    ? `Hello,\n\nMy name is ${actionUserName}, and I'm a constituent from ${districtLabel}.\n\nI'm reaching out about ${billReference}.\n\nI ${positionVerb} with ${repReference}'s position because [add your reason here].\n\nThank you for your time.`
    : "";

  useEffect(() => {
    return () => {
      window.clearTimeout(guestHighlightTimeoutRef.current);
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
    if (!stance) {
      setSelectedAction(null);
      return;
    }
    setSelectedAction("call");
  }, [stance]);

  const handleStanceClick = async (nextStance) => {
    if (!token) {
      promptGuestInteraction();
      return;
    }
    if (!billId) return;
    if (!rep?.bioguideid) {
      setInteractionError("Loading your representative details. Try again in a moment.");
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
            <span className="pill primary">
              {billLabel}
            </span>
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
            className={`ghost-btn ${
              stance === "approve" ? "active approve" : ""
            }`}
            onClick={() => handleStanceClick("approve")}
          >
            <ThumbsUp size={16} /> I agree with {repReference}
          </button>
          <button
            className={`ghost-btn ${
              stance === "disapprove" ? "active disapprove" : ""
            }`}
            onClick={() => handleStanceClick("disapprove")}
          >
            <ThumbsDown size={16} /> I disagree with {repReference}
          </button>
        </div>

        {currentStance && (
          <section className="action-guides">
            <div className="action-guides-header">
              <div>
                <div className="action-guides-label">Take Action</div>
                <h3 className="action-guides-title">
                  Use your stance to contact the office
                </h3>
              </div>
              <p className="action-guides-helper">
                Use the phone script or the website contact template to share
                your view with {repReference}.
              </p>
            </div>
            <div className="action-guide-switcher">
              <button
                type="button"
                className={`action-guide-button ${
                  selectedAction === "call" ? "active" : ""
                }`}
                onClick={() => setSelectedAction("call")}
              >
                <Phone size={16}></Phone>
                Call Script
              </button>
              <button
                type="button"
                className={`action-guide-button ${
                  selectedAction === "message" ? "active" : ""
                }`}
                onClick={() => setSelectedAction("message")}
              >
                <MessageCircle size={16}></MessageCircle>
                Message Template
              </button>
            </div>
            {selectedAction === "call" && (
              <div className="action-guide-card">
                <div className="action-guide-card-top">
                  <div>
                    <div className="action-guide-card-label">Call the Office</div>
                    <div className="action-guide-card-title">{repReference}</div>
                  </div>
                  {repDialHref ? (
                    <a className="action-guide-link" href={repDialHref}>
                      <Phone size={16}></Phone>
                      Call {rep.office_phone}
                    </a>
                  ) : (
                    <span className="action-guide-missing">
                      Office phone unavailable
                    </span>
                  )}
                </div>
                <p className="action-guide-copy">
                  Use this script when you call to leave your opinion on the bill.
                </p>
                <pre className="action-guide-template">{callScript}</pre>
              </div>
            )}
            {selectedAction === "message" && (
              <div className="action-guide-card">
                <div className="action-guide-card-top">
                  <div>
                    <div className="action-guide-card-label">
                      Website Contact Message
                    </div>
                    <div className="action-guide-card-title">{repReference}</div>
                  </div>
                  {repContactUrl ? (
                    <a
                      className="action-guide-link"
                      href={repContactUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Contact Page
                      <ExternalLink size={16}></ExternalLink>
                    </a>
                  ) : (
                    <span className="action-guide-missing">
                      Contact page unavailable
                    </span>
                  )}
                </div>
                <p className="action-guide-copy">
                  Use this as a starting point for the message you leave on the
                  representative&apos;s website contact page.
                </p>
                <pre className="action-guide-template">{messageTemplate}</pre>
              </div>
            )}
          </section>
        )}
        {interactionError && <p className="error-text">{interactionError}</p>}
      </div>
    </>
  );
}
