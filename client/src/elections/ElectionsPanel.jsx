import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

function createInitialElectionPanelState(viewer) {
  return {
    viewer,
    chamber: "all",
    selectedCandidacyId: null,
    roster: { items: [], coverage: null, status: "idle" },
    positions: {
      items: [],
      coverage: null,
      policyCounts: null,
      page: { nextCursor: null, hasMore: false },
      status: "idle",
    },
    responsesByPositionVersionId: {},
  };
}

export default function ElectionsPanel({ viewer, hidden = false }) {
  const { panelPolicyState, setPanelPolicyData } = useOutletContext();
  // Keep election filters and result state local to this panel. The parent
  // keeps it mounted while hidden and changes its key when account/address
  // context changes, so switching views preserves election state independently.
  const [electionState] = useState(() => createInitialElectionPanelState(viewer));
  const electionPolicyState = panelPolicyState.elections;
  const policyCounts = electionState.positions.policyCounts;
  const policyAreas = useMemo(() => policyCounts
    ? Object.entries(policyCounts.byPolicyArea ?? {}).map(([name, count]) => ({ name, count }))
    : [], [policyCounts]);
  const hasPositions = electionState.positions.items.length > 0;

  useEffect(() => {
    setPanelPolicyData("elections", {
      policyAreas,
      totalPolicyCount: policyCounts?.all ?? null,
    });
  }, [policyAreas, policyCounts, setPanelPolicyData]);

  return (
    <section id="elections-feed-panel" className="elections-panel" role="tabpanel"
      data-viewer={electionState.viewer}
      aria-labelledby="feed-view-tab-elections" tabIndex={0} hidden={hidden}>
      <h2 className="section-title">Elections</h2>
      {!hasPositions && <p role="status">
        Campaign positions are not available yet{electionPolicyState.selectedPolicyArea
          ? ` for ${electionPolicyState.selectedPolicyArea}` : ""}.
      </p>}
    </section>
  );
}
