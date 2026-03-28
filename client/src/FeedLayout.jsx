import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import "./Feed.css";
import { Home, Search, User } from "lucide-react";

export default function FeedLayout() {
  const location = useLocation();
  const isFeedRoute = location.pathname === "/feed";
  const [policyAreas, setPolicyAreas] = useState([]);
  const [totalPolicyCount, setTotalPolicyCount] = useState(0);
  const [selectedPolicyArea, setSelectedPolicyArea] = useState(null);
  const [isPolicySearchOpen, setIsPolicySearchOpen] = useState(false);
  const [policySearch, setPolicySearch] = useState("");
  const normalizedPolicySearch = policySearch.trim().toLowerCase();
  const visiblePolicyAreas = policyAreas.filter((policyArea) =>
    policyArea.name.toLowerCase().includes(normalizedPolicySearch),
  );

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
          <NavLink to="/feed" className="nav-item">
            <Home className="nav-icion" strokeWidth={1.75}></Home>
            <span>Feed</span>
          </NavLink>
          <NavLink to="/profile" className="nav-item">
            <User className="nav-icon" strokeWidth={1.75} />
            <span>Profile</span>
          </NavLink>
        </nav>
        {isFeedRoute && (
          <section className="policy-sidebar">
            <div className="policy-sidebar-header">
              <span className="policy-sidebar-label">Policy Areas</span>
              <button
                type="button"
                className="policy-search-toggle"
                onClick={() => setIsPolicySearchOpen((prev) => !prev)}
                aria-expanded={isPolicySearchOpen}
                aria-controls="policy-search-input"
                aria-label="Search policy areas"
                title="Search policy areas"
              >
                <Search size={14} />
              </button>
            </div>
            {isPolicySearchOpen && (
              <input
                id="policy-search-input"
                className="policy-search-input"
                type="search"
                placeholder="Search policy areas"
                value={policySearch}
                onChange={(event) => setPolicySearch(event.target.value)}
              />
            )}
            <div className="policy-list">
              <button
                type="button"
                className={`policy-option ${
                  selectedPolicyArea === null ? "active" : ""
                }`}
                onClick={() => setSelectedPolicyArea(null)}
              >
                <span>All</span>
                <span className="policy-count">{totalPolicyCount}</span>
              </button>
              {visiblePolicyAreas.map((policyArea) => (
                <button
                  key={policyArea.name}
                  type="button"
                  className={`policy-option ${
                    selectedPolicyArea === policyArea.name ? "active" : ""
                  }`}
                  onClick={() => setSelectedPolicyArea(policyArea.name)}
                >
                  <span>{policyArea.name}</span>
                  <span className="policy-count">{policyArea.count}</span>
                </button>
              ))}
              {policyAreas.length > 0 && visiblePolicyAreas.length === 0 && (
                <p className="policy-empty">No matching policy areas.</p>
              )}
            </div>
          </section>
        )}
      </aside>
      <main className="feed-main">
        <Outlet
          context={{
            selectedPolicyArea,
            setSelectedPolicyArea,
            setSidebarPolicyAreas: setPolicyAreas,
            setSidebarTotalPolicyCount: setTotalPolicyCount,
          }}
        />
      </main>
    </div>
  );
}
