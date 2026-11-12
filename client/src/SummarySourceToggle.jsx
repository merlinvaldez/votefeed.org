import { ScrollText } from "lucide-react";
import "./SummarySourceToggle.css";

export default function SummarySourceToggle({ officialHtml, showOriginal, onToggle }) {
  const available = typeof officialHtml === "string" && Boolean(officialHtml.trim());
  const label = !available ? "Official summary not yet available"
    : showOriginal ? "Show simplified summary"
    : "This is an AI-generated summary. Toggle here to see the original from Congress.gov.";
  return <span className="summary-source-control" title={label}>
    <button type="button" className={`summary-source-toggle${available && showOriginal ? " active" : ""}`}
      disabled={!available} aria-label={label} aria-pressed={available && showOriginal}
      onClick={() => { if (available) onToggle?.(); }}>
      <ScrollText size={24} strokeWidth={2} aria-hidden="true" />
    </button>
  </span>;
}
