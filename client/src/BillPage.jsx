import { useEffect, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import "./Feed.css";
import "./BillPage.css";
import { ThumbsUp, ThumbsDown, MessageCircle, ArrowLeft } from "lucide-react";
import { API_BASE } from "./constants";

const getVotePillClass = (voteVal) => {
  if (!voteVal || voteVal === "Not Voting") return "neutral";
  if (voteVal === "Yea" || voteVal === "Aye") return "success";
  if (voteVal === "No" || voteVal === "Nay") return "success";
  return "neutral";
};

export default function BillPage() {
  const navigate = useNavigate();
  const { billNumber } = useParams();
  const { state } = useLocation();
  const [bill, setBill] = useState(state?.bill || state?.vote || null);
  const [status, setStatus] = useState(bill ? "ready" : "loading");
  const [error, setError] = useState("");
  const [stance, setStance] = useState(null);
  const [comment, setComment] = useState("");
  //   const rep = state?.rep;

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

  return (
    <>
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={18}></ArrowLeft> Back to Feed
      </button>
      <div className="leg-card">
        <div className="leg-top">
          <span className="pill primary">
            {" "}
            H.R. {bill?.legislationnumber || billNumber}
          </span>
          {bill?.vote && (
            <span className={`pill ${getVotePillClass(bill.vote)}`}>
              Rep Voted: {bill.vote}
            </span>
          )}
        </div>
        <div className="leg-title">{bill?.title || "loading bill..."}</div>
        {status === "loading" && <p>Loading summary</p>}
        {status === "error" && <p className="error-text">{error}</p>}
        {bill?.summary && (
          <div
            className="leg-body"
            dangerouslySetInnerHTML={{ __html: bill.summary }}
          ></div>
        )}

        <div className="vote-actions">
          <button
            className={`ghost-btn ${stance === "approve" ? "active" : ""}`}
            onClick={() => setStance("approve")}
          >
            <ThumbsUp size={16} /> I Agree
          </button>
          <button
            className={`ghost-btn ${stance === "disapprove" ? "active" : ""}`}
            onClick={() => setStance("disapprove")}
          >
            <ThumbsDown size={16} /> I Disagree
          </button>
        </div>

        <div className="comment-box">
          <div className="comment-ahead">
            <div className="avatar">Me</div>
            <div className="comments">
              <MessageCircle size={16}> 0 Comments</MessageCircle>
            </div>
          </div>
          <textarea
            placeholder="Write a comment to your Representative"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          ></textarea>
          <div className="comment-actions">
            <button className="primary-btn" onClick={() => alert("TODO: post")}>
              {" "}
              Comment
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
