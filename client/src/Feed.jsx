import "./Feed.css";

function Feed() {
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
            <span className="nav-icon">🏠</span>
            <span>Feed</span>
          </div>
          <div className="nav-item">
            <span className="nav-icon">👤</span>
            <span>Profile</span>
          </div>
        </nav>
      </aside>

      <main className="feed-main">
        <div className="guest-bar">
          <div className="guest-left">
            <span className="guest-icon">ℹ️</span>
            <div>
              <div className="guest-title">Viewing as Guest</div>
              <div className="guest-sub">Your interactions won’t be saved.</div>
            </div>
          </div>
          <button className="guest-cta">Log In / Sign Up</button>
        </div>

        <section className="member-card">
          <div className="member-name">Alexandria Ocasio-Cortez</div>
          <div className="member-meta">📍 Serving NY District 14</div>
        </section>

        <section className="feed-section">
          <h2 className="section-title">Legislative Feed</h2>
          <div className="leg-card">
            <div className="leg-top">
              <span className="pill primary">H.R. 8070</span>
              <span className="leg-meta">Vote #204 • Yesterday</span>
            </div>
            <div className="leg-title">Servicemember Quality of Life Act</div>
            <p className="leg-body">
              Authorizes appropriations for fiscal year 2025 for military
              activities of the Department of Defense, for military
              construction, and for defense activities of the Department of
              Energy, to prescribe military personnel strengths.
            </p>
            <div className="leg-vote">
              <span className="pill success">Rep. AOC Voted</span>
              <span className="pill success strong">YEA (Approve)</span>
            </div>
            <div className="leg-actions">
              <button className="ghost-btn">👍 Approve</button>
              <button className="ghost-btn">👎 Disapprove</button>
              <div className="comments">💬 24 Comments</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Feed;
