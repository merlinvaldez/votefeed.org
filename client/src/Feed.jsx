import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";
import "./Feed.css";
import {
  Info,
  MapPin,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  IdCard,
} from "lucide-react";

function Feed(props) {
  const { token, authFetch } = useAuth();
  const isAuthed = Boolean(token);
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || props.state;

  const [feedState, setFeedState] = useState(location.state || props.state);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [interactions, setInteractions] = useState([]);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    if (feedState?.rep && feedState?.votes) return;
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const resp = await authFetch(`${API_BASE}/users/me/feed`);
        if (!resp.ok) throw new Error("Failed to load feed");
        const feed = await resp.json();
        if (!cancelled) setFeedState(feed);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load feed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedState, token, authFetch]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const meResp = await authFetch(`${API_BASE}/users/me`);
        if (!meResp.ok) throw new Error("Failed to load user");
        const me = await meResp.json();
        if (!cancelled) setUserId(me.id);

        const interactionsResp = await authFetch(
          `${API_BASE}/interactions/users/${me.id}`
        );
        if (!interactionsResp.ok)
          throw new Error("Failed to load interactions");
        const data = await interactionsResp.json();
        if (!cancelled) setInteractions(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load interactions");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, authFetch]);

  const interactionsByBill = {};
  for (const interaction of interactions) {
    interactionsByBill[interaction.bill_id] = interaction;
  }

  const handleStance = async (billId, stance) => {
    if (!userId) return;

    try {
      const existing = interactionsByBill[billId];
      if (existing?.stance === stance) {
        const resp = await authFetch(
          `${API_BASE}/interactions/${existing.id}`,
          { method: "DELETE" }
        );
        if (!resp.ok) throw new Error("Failed to delete stance");
        setInteractions((prev) => prev.filter((i) => i.id !== existing.id));
        return;
      }

      const resp = await authFetch(
        existing
          ? `${API_BASE}/interactions/${existing.id}/stance`
          : `${API_BASE}/interactions/addstance`,
        {
          method: existing ? "PUT" : "POST",
          body: JSON.stringify(
            existing
              ? { stance }
              : {
                  user_id: userId,
                  bill_id: billId,
                  stance,
                }
          ),
        }
      );
      if (!resp.ok) throw new Error("Failed to save stance");
      const saved = await resp.json();

      setInteractions((prev) => {
        const withoutCurrent = prev.filter((i) => i.id !== saved.id);
        return [...withoutCurrent, saved];
      });
    } catch (err) {
      setError(err.message || "Failed to save stance");
    }
  };

  if (loading) return <div className="feed-loading">Loading feed...</div>;
  if (error) return <div className="error">{error}</div>;

  if (!feedState?.rep || !feedState?.votes) {
    return <div>Missing feed data</div>;
  }
  const { rep, votes } = feedState;

  const goToBill = (vote) => {
    const billNumber = vote.legislationnumber;
    navigate(`/bill/${billNumber}`, { state: { rep, bill: vote } });
  };
  return (
    <>
      {!isAuthed && (
        <div className="guest-bar">
          <div className="guest-left">
            <Info className="guest-icon" strokeWidth={1.75}></Info>
            <div>
              <div className="guest-title">Viewing as Guest</div>
              <div className="guest-sub">Your interactions won’t be saved.</div>
            </div>
          </div>
          <button className="guest-cta" onClick={() => navigate("/login")}>
            Log In / Sign Up
          </button>
        </div>
      )}

      <section className="member-card">
        <div className="member-name">{rep.full_name}</div>
        <div className="member-meta">
          <span className="meta-line">
            <IdCard size={16} className="meta-icon"></IdCard>
            {rep.party} Party
          </span>
          <span className="meta-line">
            <MapPin size={16} className="meta-icon"></MapPin>
            Serving {rep.state} District {rep.congressionaldistrict}
          </span>
        </div>
      </section>

      <section className="feed-section">
        <h2 className="section-title">Legislative Feed</h2>
        {votes.length === 0 && <p>No votes found for this member.</p>}

        {votes.map((vote) => {
          const interaction = interactionsByBill[vote.bill_id];

          return (
            <div key={vote.legislationnumber} className="leg-card">
              <div className="leg-top">
                <span
                  className="pill primary"
                  onClick={() => goToBill(vote)}
                  style={{ cursor: "pointer" }}
                >
                  HR {vote.legislationnumber}
                </span>
              </div>
              <div
                className="leg-body"
                dangerouslySetInnerHTML={{ __html: vote.summary }}
              />
              <div className="leg-vote">
                {(() => {
                  let voteClass = "neutral";
                  if (vote.vote === "Yea" || vote.vote === "Aye") {
                    voteClass = "success";
                  } else if (vote.vote === "Nay" || vote.vote === "No") {
                    voteClass = "danger";
                  } else if (vote.vote === "Not Voting") {
                    voteClass = "neutral";
                  }
                  return (
                    <span className={`pill ${voteClass}`}>
                      {rep.full_name} Voted: {vote.vote}
                    </span>
                  );
                })()}
              </div>
              <div className="leg-actions">
                <button
                  className={`ghost-btn ${
                    interaction?.stance === "approve" ? "active approve" : ""
                  }`}
                  onClick={() => handleStance(vote.bill_id, "approve")}
                >
                  <ThumbsUp size={16} /> Approve
                </button>

                <button
                  className={`ghost-btn ${
                    interaction?.stance === "disapprove"
                      ? "active disapprove"
                      : ""
                  }`}
                  onClick={() => handleStance(vote.bill_id, "disapprove")}
                >
                  <ThumbsDown size={16} />
                  Disapprove
                </button>

                <div
                  className="comments"
                  onClick={() => goToBill(vote)}
                  style={{ cursor: "pointer" }}
                >
                  <MessageCircle size={16} />
                  {interaction?.user_comment ? "1 Comment" : "0 Comments"}
                </div>
              </div>

            </div>
          );
        })}
      </section>
    </>
  );
}

export default Feed;
