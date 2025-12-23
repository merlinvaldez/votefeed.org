import { useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:4000";

function LandingPage() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!address.trim()) {
      setError(`Please enter an address.`);
      return;
    }
    setStatus(`loading`);
    setError("");
    setResult(null);

    try {
      const districtResp = await fetch(
        `${API_BASE}/districts?address=${address.trim()}`
      );
      if (!districtResp.ok) {
        const msg = await districtResp.text();
        throw new Error(
          msg || `District lookup failed (${districtResp.status})`
        );
      }
      const districtData = await districtResp.json();
      // const district = districtData.congressionalDistrict;

      //TODO build getRepbydistrict route
    } catch (err) {
      setError(err.message || `Something went wrong`);
      setStatus(`error`);
    }
  };
  return (
    <div className="page">
      <section className="hero">
        <div className="logo-lockup" aria-label="VoteFeed">
          <span className="logo-mark">▸</span>
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
            <label htmlFor="address">Residential Address</label>
            <input
              id="address"
              name="address"
              type="text"
              placeholder="123 Main St, Queens, NY 11101"
              autoComplete="street-address"
            />
            <button type="submit">Check my Rep</button>
          </form>
          <div className="login-row">
            <span>Already have an account?</span>
            <a href="#">Log in</a>
          </div>
          <div className="powered-by">Powered by U.S. Census Geocoder API</div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
