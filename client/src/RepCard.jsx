import { IdCard, MapPin } from "lucide-react";
import {
  GaugeContainer,
  GaugeReferenceArc,
  GaugeValueArc,
  GaugeValueText,
  gaugeClasses,
  useGaugeState,
} from "@mui/x-charts/Gauge";
import "./RepCard.css";

const getRepInitials = (fullName = "") => {
  const normalized = fullName.trim();
  if (!normalized) return "US";
  const parts = normalized.split(/[\s,]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
};

const getAlignmentColor = (percent) => {
  if (percent >= 67) return "#16a34a";
  if (percent >= 40) return "#d97706";
  return "#dc2626";
};

function GaugePointer() {
  const { valueAngle, outerRadius, cx, cy } = useGaugeState();

  if (
    valueAngle == null ||
    outerRadius == null ||
    cx == null ||
    cy == null
  ) {
    return null;
  }

  const needleLength = Number(outerRadius) * 0.58;
  const pivotY = cy - Number(outerRadius) * 0.19;
  const targetX = cx + needleLength * Math.sin(valueAngle);
  const targetY = pivotY - needleLength * Math.cos(valueAngle);

  return (
    <g className="member-gauge-pointer">
      <line
        x1={cx}
        y1={pivotY}
        x2={targetX}
        y2={targetY}
        className="member-gauge-needle"
      />
      <circle cx={cx} cy={pivotY} r="6" className="member-gauge-pivot" />
    </g>
  );
}

export default function RepCard({ rep, alignment }) {
  const repInitials = getRepInitials(rep?.full_name);
  const alignmentPercent = Math.max(0, Math.min(100, alignment?.percent ?? 0));
  const alignmentColor = getAlignmentColor(alignmentPercent);

  return (
    <section className="member-card">
      <div className="member-card-row">
        <div className="member-avatar">
          {rep?.image_url ? (
            <img
              className="member-avatar-image"
              src={rep.image_url}
              alt={`${rep.full_name} official portrait`}
            />
          ) : (
            <span className="member-avatar-fallback">{repInitials}</span>
          )}
        </div>
        <div className="member-copy">
          <div className="member-name">{rep?.full_name}</div>
          <div className="member-meta">
            <span className="meta-line">
              <IdCard size={16} className="meta-icon"></IdCard>
              U.S. Representative
            </span>
            <span className="meta-line">
              <span className="meta-dot" aria-hidden="true"></span>
              {rep?.party} Party
            </span>
            <span className="meta-line">
              <MapPin size={16} className="meta-icon"></MapPin>
              {rep?.state} District {rep?.congressionaldistrict}
            </span>
          </div>
        </div>
      </div>
      {alignment && (
        <div
          className="member-alignment"
          style={{ "--alignment-accent": alignmentColor }}
        >
          <div className="member-alignment-chart">
            <GaugeContainer
              width={176}
              height={112}
              value={alignmentPercent}
              valueMin={0}
              valueMax={100}
              startAngle={-90}
              endAngle={90}
              innerRadius="72%"
              outerRadius="98%"
              cornerRadius="50%"
              aria-label="Policy alignment gauge"
              sx={{
                [`& .${gaugeClasses.referenceArc}`]: {
                  fill: "#dde2e8",
                },
                [`& .${gaugeClasses.valueArc}`]: {
                  fill: alignmentColor,
                },
                [`& .${gaugeClasses.valueText}`]: {
                  transform: "translate(0px, 2px)",
                },
              }}
            >
              <GaugeReferenceArc />
              <GaugeValueArc />
              <GaugeValueText
                text={({ value }) => `${Math.round(value ?? 0)}%`}
                style={{
                  fill: "var(--alignment-accent)",
                  fontSize: 22,
                  fontWeight: 800,
                  textAnchor: "middle",
                  dominantBaseline: "central",
                }}
              />
              <GaugePointer />
            </GaugeContainer>
          </div>
          <div className="member-alignment-label">Policy Alignment</div>
          <p className="member-alignment-copy">
            You agree on{" "}
            <span className="member-alignment-emphasis">
              {alignment.approveCount}
            </span>{" "}
            out of {alignment.totalCount} votes
          </p>
        </div>
      )}
    </section>
  );
}
