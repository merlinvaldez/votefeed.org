import { IdCard, MapPin } from "lucide-react";
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

export default function RepCard({ rep }) {
  const repInitials = getRepInitials(rep?.full_name);

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
    </section>
  );
}
