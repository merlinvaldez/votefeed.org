import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import "./Feed.css";
import { Home, Search, User } from "lucide-react";

const createPanelPolicyState = (totalPolicyCount = null, scopeKey = null) => ({
  policyAreas: [],
  totalPolicyCount,
  selectedPolicyArea: null,
  scopeKey,
});

export default function FeedLayout() {
  const location = useLocation();
  const isFeedRoute = location.pathname === "/feed";
  const [activePanel, setActivePanel] = useState("legislative");
  const [panelPolicyState, setPanelPolicyState] = useState(() => ({
    legislative: createPanelPolicyState(0),
    elections: createPanelPolicyState(null),
  }));
  const [policySearchByPanel, setPolicySearchByPanel] = useState({
    legislative: "",
    elections: "",
  });
  const [isPolicySearchOpen, setIsPolicySearchOpen] = useState(false);
  const activePolicyState = panelPolicyState[activePanel];
  const policyAreas = activePolicyState.policyAreas;
  const totalPolicyCount = activePolicyState.totalPolicyCount;
  const activeSelectedPolicyArea = activePolicyState.selectedPolicyArea;
  const selectedPolicyArea = panelPolicyState.legislative.selectedPolicyArea;
  const policySearch = policySearchByPanel[activePanel];
  const normalizedPolicySearch = policySearch.trim().toLowerCase();
  const visiblePolicyAreas = policyAreas.filter((policyArea) =>
    policyArea.name.toLowerCase().includes(normalizedPolicySearch),
  );

  const setPanelPolicyArea = useCallback((panel, value) => {
    setPanelPolicyState((previous) => ({
      ...previous,
      [panel]: { ...previous[panel], selectedPolicyArea: value },
    }));
  }, []);

  const setSelectedPolicyArea = useCallback((value) => {
    setPanelPolicyArea("legislative", value);
  }, [setPanelPolicyArea]);

  const setPanelPolicyData = useCallback((panel, { policyAreas: nextAreas, totalPolicyCount: nextCount }) => {
    setPanelPolicyState((previous) => {
      const current = previous[panel];
      const policyAreasValue = nextAreas ?? [];
      const totalPolicyCountValue = nextCount ?? null;
      if (current.policyAreas === policyAreasValue && current.totalPolicyCount === totalPolicyCountValue) return previous;
      return {
        ...previous,
        [panel]: { ...current, policyAreas: policyAreasValue, totalPolicyCount: totalPolicyCountValue },
      };
    });
  }, []);

  const setPanelScopeKey = useCallback((panel, scopeKey) => {
    setPanelPolicyState((previous) => {
      if (previous[panel].scopeKey === scopeKey) return previous;
      return {
        ...previous,
        [panel]: createPanelPolicyState(panel === "legislative" ? 0 : null, scopeKey),
      };
    });
    setPolicySearchByPanel((previous) => ({ ...previous, [panel]: "" }));
  }, []);

  return (
    <div className="feed-layout">
      <aside className="feed-sidebar">
        <Link to="/feed" className="brand" aria-label="VoteFeed feed">
          <span className="brand-mark">
            <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
          </span>
          <span className="brand-name">VoteFeed</span>
        </Link>

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
                onChange={(event) => setPolicySearchByPanel((previous) => ({
                  ...previous,
                  [activePanel]: event.target.value,
                }))}
              />
            )}
            <div className="policy-list">
              <button
                type="button"
                className={`policy-option ${
                  activeSelectedPolicyArea === null ? "active" : ""
                }`}
                onClick={() => setPanelPolicyArea(activePanel, null)}
              >
                <span>All</span>
                {totalPolicyCount != null && <span className="policy-count">{totalPolicyCount}</span>}
              </button>
              {visiblePolicyAreas.map((policyArea) => (
                <button
                  key={policyArea.name}
                  type="button"
                  className={`policy-option ${
                    activeSelectedPolicyArea === policyArea.name ? "active" : ""
                  }`}
                  onClick={() => setPanelPolicyArea(activePanel, policyArea.name)}
                >
                  <span>{policyArea.name}</span>
                  {policyArea.count != null && <span className="policy-count">{policyArea.count}</span>}
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
            activePanel,
            setActivePanel,
            panelPolicyState,
            setPanelPolicyArea,
            setPanelPolicyData,
            setPanelScopeKey,
            selectedPolicyArea,
            setSelectedPolicyArea,
          }}
        />
      </main>
    </div>
  );
}
