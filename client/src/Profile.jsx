import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";
import "./Profile.css";

export default function Profile() {
  const { token, authFetch, setToken } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    async function loadProfile() {
      try {
        const meResp = await authFetch(`${API_BASE}/users/me`);
        if (!meResp.ok) throw new Error("Failed to load profile");
        const me = await meResp.json();
        setUser(me);
        const feedResp = await authFetch(`${API_BASE}/users/me/feed`);
        if (!feedResp.ok) throw new Error("Failed to load district data");
        const feed = await feedResp.json();
        setRep(feed.rep || null);
        setLoading(false);
      } catch (err) {
        setError(err.message || "Something went wrong");
        setLoading(false);
      }
    }
    loadProfile();
  }, [token, authFetch, navigate]);

  const initials =
    user?.first_name && user?.last_name
      ? `${user.first_name[0] || ""}${user.last_name[0] || ""}`.toUpperCase()
      : "";

  async function handleUpdateDistrict(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const address = `${street.trim()}, ${city.trim()}, ${stateCode.trim()} ${zip.trim()}`;
      const resp = await authFetch(`${API_BASE}/users/me/updateDistrict`, {
        method: "PUT",
        body: JSON.stringify({ id: user.id, address }),
      });
      if (!resp.ok) throw new Error((await resp.text()) || "Update failed");

      const meResp = await authFetch(`${API_BASE}/users/me`);
      if (!meResp.ok) throw new Error("Failed to refresh profile");
      const me = await meResp.json();
      setUser(me);

      const feedResp = await authFetch(`${API_BASE}/users/me/feed`);
      if (!feedResp.ok) throw new Error("Failed to refresh district data");
      const feed = await feedResp.json();
      setRep(feed.rep || null);

      setShowForm(false);
      setStreet("");
      setCity("");
      setStateCode("");
      setZip("");
    } catch (err) {
      setFormError(err.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="profile-loading">Loading profile...</div>;
  if (error) return <div className="profile-page-error">{error}</div>;

  return (
    <>
      <header className="profile-header">
        <div className="avatar-circle">{initials}</div>
        <div className="profile-meta">
          <div className="profile-name">
            {user.first_name} {user.last_name}
          </div>
          <div className="profile-email">{user.email}</div>
        </div>
      </header>
      <section className="profile-card">
        <h2>Representative</h2>
        {rep ? (
          <>
            <div className="rep-name">{rep.full_name}</div>
            <div className="rep-meta">
              {rep.party} • {rep.state}
            </div>
          </>
        ) : (
          <div className="rep-meta">No representative data.</div>
        )}
      </section>

      <section className="profile-card">
        <h2>District</h2>
        <div>
          {user.state} District {user.district}
        </div>
        <button
          className="profile-primary-btn"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "Update"}
        </button>
        {showForm && (
          <form className="profile-update-form" onSubmit={handleUpdateDistrict}>
            <input
              type="text"
              placeholder="Street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="State (e.g., NY)"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="ZIP"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              required
            />
            <button
              className="profile-primary-btn"
              type="submit"
              disabled={saving}
            >
              {saving ? "Updating..." : "Save"}
            </button>
            {formError && <div className="profile-page-error">{formError}</div>}
          </form>
        )}
      </section>

      <section className="profile-card logout">
        <button
          className="profile-ghost-btn"
          onClick={() => {
            setToken(null);
            navigate("/login", { replace: true });
          }}
        >
          Log out
        </button>
      </section>
    </>
  );
}
