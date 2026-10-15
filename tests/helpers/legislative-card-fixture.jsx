import React from "react";
import { createRoot } from "react-dom/client";
import Card from "./LegislativeVoteCard";
import "./index.css";
import "./Feed.css";
const stress = new URLSearchParams(location.search).has("stress");
const members = [
  { bioguideId: "A", party: "Democratic", name: stress ? "Chris Van Hollen" : "Chuck Schumer", chamber: "Senate", memberVoteId: 1 },
  { bioguideId: "B", party: stress ? "Republican" : "Democratic", name: stress ? "Catherine Cortez Masto" : "Kirsten Gillibrand", chamber: "Senate", memberVoteId: 2 },
];
const cases = stress ? ["approve", "disapprove", "mixed", "partial", "neutral", "Not Voting", "Present", "House", "loading", "error", "portrait"] : ["single", "pair"];
function App() {
  const [original, setOriginal] = React.useState({});
  const [answers, setAnswers] = React.useState({});
  const [large, setLarge] = React.useState(false);
  const [theme, setTheme] = React.useState("light");
  React.useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <main style={{ padding: 16 }}>
    <h1>Legislative Feed</h1>
    <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle theme</button>
    <button onClick={() => setLarge(!large)}>Toggle enlarged text</button>
    <section className="feed-section" style={{ marginTop: 16, fontSize: large ? "32px" : "16px" }}>
      {cases.map((mode, index) => {
        const people = ["single", "House", "portrait"].includes(mode) ? [mode === "House" ? {
          ...members[0], name: "Robert Garcia Jr.", chamber: "House"
        } : { ...members[0], ...(mode === "portrait" ? { portrait: "/missing-portrait.png" } : {}) }] : members;
        const vote = { id: "card-" + mode, members: people,
          event: { chamber: people[0].chamber, congress: 119, session: 2, rollCall: index + 1 },
          position: ["Not Voting", "Present"].includes(mode) ? mode : index % 2 ? "Nay" : "Yea",
          bill: { id: index + 7, congress: 119, type: "hr", number: 9576 },
          legislation_type: "hr", legislationnumber: 9576, voted_on: "2026-09-16T12:00:00Z",
          simplifiedText: ["loading", "error"].includes(mode) ? null : "authorize the Justice Department division that fights fraud against taxpayer-funded programs" + (stress ? ", including protections for communities with long names and complex local circumstances" : ""),
          officialSummary: "<p>Official summary from Congress.</p>", vote_result: "Passed" };
        const initial = people.map((m, i) => ({ id: i + 1, bill_id: vote.bill.id, rep_bioguide_id: m.bioguideId, member_vote_id: m.memberVoteId,
          stance: mode === "disapprove" || mode === "mixed" && i === 1 ? "disapprove" : "approve" }))
          .filter((_, i) => ["approve", "disapprove", "mixed"].includes(mode) || mode === "partial" && i === 0);
        return <Card key={mode} vote={vote} interactions={answers[mode] ?? initial} isAuthed={true} stancePending={{}}
          showOriginalByCard={original} setShowOriginalByCard={setOriginal}
          aiLoadingByBill={{ [JSON.stringify([119, "hr", 9576])]: mode === "loading" }} aiSummaryByBill={{}}
          aiErrorByBill={{ [JSON.stringify([119, "hr", 9576])]: mode === "error" ? "Summary could not be loaded." : null }}
          loadAiSummary={() => {}} goToBill={() => {}} handleCommentIntent={() => {}}
          handleStance={(card, stance) => setAnswers(prev => ({ ...prev, [mode]: people.map((m, i) => ({ id: i + 1,
            bill_id: card.bill.id, rep_bioguide_id: m.bioguideId, member_vote_id: m.memberVoteId,
            stance: (prev[mode] ?? initial).length === people.length && (prev[mode] ?? initial).every(a => a.stance === stance) ? null : stance })) }))} />;
      })}
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
