import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE } from "./constants.js";
import "./LandingPage.css";

const STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

function LandingPage() {
  const navigate = useNavigate();
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanStreet = street.trim();
    const cleanCity = city.trim();
    const cleanState = stateCode.trim();
    const cleanZip = zip.trim();

    if (!cleanStreet || !cleanCity || !cleanState || !cleanZip) {
      setError("Street, city, state, and ZIP are required.");
      return;
    }

    setStatus(`loading`);
    setError("");

    try {
      const districtResp = await fetch(
        `${API_BASE}/districts?address=${cleanStreet}, ${cleanCity}, ${cleanState} ${cleanZip}`
      );
      if (!districtResp.ok) {
        const msg = await districtResp.text();
        throw new Error(
          msg || `District lookup failed (${districtResp.status})`
        );
      }
      const districtData = await districtResp.json();

      const repResp = await fetch(
        `${API_BASE}/reps/district/${districtData.state}/${districtData.congressionalDistrict}`
      );
      if (!repResp.ok) {
        const msg = await repResp.text();
        throw new Error(msg || `Rep lookup failed (${repResp.status})`);
      }
      const repData = await repResp.json();
      setStatus("loading-votes");
      const repId = repData.bioguideid;
      const votesResp = await fetch(`${API_BASE}/housevotes/member/${repId}`);
      if (!votesResp.ok) {
        const msg = await votesResp.text();
        throw new Error(
          msg || `Voting record lookup failed (${votesResp.status})`
        );
      }
      const { votes = [] } = await votesResp.json();
      navigate("/feed", {
        state: { district: districtData, rep: repData, votes },
      });
      setStatus("success");
      console.log(status);
    } catch (err) {
      setError(err.message || `Something went wrong`);
      setStatus(`error`);
    }
  };
  const buttonLabel =
    status === "loading"
      ? "Looking up district..."
      : status === "loading-votes"
      ? "Loading voting record"
      : "Check my Rep";
  return (
    <div className="page">
      <section className="hero">
        <div className="logo-lockup" aria-label="VoteFeed">
          <span className="logo-mark">
            <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
          </span>
          <span className="logo-text">VoteFeed</span>
        </div>
        <div className="hero-copy">
          <h1>Democracy happens in your feed.</h1>
          <p>
            Track every vote. Hold your Representative accountable. Engage with
            your district.
          </p>
        </div>
        <div className="hero-footer">© 2025 VoteFeed Inc.</div>
      </section>

      <section className="form-panel">
        <div className="form-card">
          <div className="form-header">
            <h2>Find your District</h2>
            <p>Enter your address to see your Rep&apos;s voting record.</p>
          </div>
          <form className="address-form" onSubmit={handleSubmit}>
            <label htmlFor="street">Street Address</label>
            <input
              id="street"
              name="street"
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="123 Main St"
              autoComplete="address-line1"
              required
            />
            <label htmlFor="city">City</label>
            <input
              id="city"
              name="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Queens"
              autoComplete="address-level2"
              required
            />

            <label htmlFor="state">State</label>
            <select
              id="state"
              name="state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              required
            >
              <option value="">Select State</option>
              {STATES.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <label htmlFor="zip">ZIP code</label>
            <input
              id="zip"
              name="zip"
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="11101"
              autoComplete="postal-code"
              inputMode="numeric"
              required
            />
            <button
              type="submit"
              disabled={status === "loading" || status === "loading-votes"}
            >
              {buttonLabel}
            </button>

            {error && <div className="error">{error}</div>}
          </form>
          <div className="login-row">
            <span>Already have an account?</span>
            <Link to="/login">Log in</Link>
          </div>
          <div className="powered-by">Powered by U.S. Census Geocoder API</div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
