import { useLocation, useNavigate } from "react-router-dom";
import "./Feed.css";
import {
  Home,
  User,
  Info,
  MapPin,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  IdCard,
} from "lucide-react";

function Feed() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const { rep, votes } = state;

  const goToBill = (vote) => {
    const billNumber = vote.legislationnumber;
    navigate(`/bill/${billNumber}`, { state: { rep, bill: vote } });
  };
  return (
    <div className="feed-layout">
      <aside className="feed-sidebar">
        <div className="brand">
          <span className="brand-mark">
            <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
          </span>
          <span className="brand-name">VoteFeed</span>
        </div>
        <nav className="nav">
          <div className="nav-item active">
            <Home className="nav-icon" strokeWidth={1.75}></Home>
            <span>Feed</span>
          </div>
          <div className="nav-item">
            <User className="nav-icon" strokeWidth={1.75}></User>
            <span>Profile</span>
          </div>
        </nav>
      </aside>

      <main className="feed-main">
        <div className="guest-bar">
          <div className="guest-left">
            <Info className="guest-icon" strokeWidth={1.75}></Info>
            <div>
              <div className="guest-title">Viewing as Guest</div>
              <div className="guest-sub">Your interactions won’t be saved.</div>
            </div>
          </div>
          <button className="guest-cta">Log In / Sign Up</button>
        </div>

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

          {votes.map((vote) => (
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
              {/* <div className="leg-title">{vote.title}</div> */}
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
                <button className="ghost-btn">
                  <ThumbsUp size={16} /> Approve
                </button>
                <button className="ghost-btn">
                  <ThumbsDown size={16} />
                  Disapprove
                </button>
                <div
                  className="comments"
                  onClick={() => goToBill(vote)}
                  style={{ cursor: "pointer" }}
                >
                  <MessageCircle size={16} />0 Comments
                </div>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

export default Feed;
