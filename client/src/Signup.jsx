import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, STATES } from "./constants";
import { useAuth } from "./AuthContext";
import "./LandingPage.css";
import "./Login.css";

export default function Signup() {
  const navigate = useNavigate();
  const { setToken } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const address = `${street.trim()},${city.trim()}, ${stateCode.trim()}, ${zip.trim()}`;
      const resp = await fetch(`${API_BASE}/users/signup`, {
        method: "POST",
        headers: { "Content-Type": "Application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          address,
        }),
      });
      if (!resp.ok) throw new Error((await resp.text()) || "Signup Failed");
      const token = await resp.text();
      setToken(token);

      const feedResp = await fetch(`${API_BASE}/users/me/feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!feedResp.ok) throw new Error("Failed to load feed");
      const feed = await feedResp.json();
      navigate("/feed", { state: { ...feed, authed: true } });
      setStatus("success");
    } catch (err) {
      setError(err.message || "Signup failed");
      setStatus("error");
    }
  };

  return (
    <div className="login-layout">
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

      <section className="login-panel">
        <div className="login-card">
          <button
            className="back-link"
            type="button"
            onClick={() => navigate("/")}
          >
            ← Back to Search
          </button>
          <h1>Create Account</h1>
          <p className="login-sub">Sign up to track votes and comment.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="first-name">First name</label>
            <input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />

            <label htmlFor="last-name">Last name</label>
            <input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />

            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <label htmlFor="street">Street Address</label>
            <input
              id="street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              required
            />

            <label htmlFor="city">City</label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />

            <label htmlFor="state">State</label>
            <select
              id="state"
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
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              required
            />

            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Creating account..." : "Sign Up"}
            </button>
            {error && <div className="error">{error}</div>}
          </form>

          <div className="login-footer">
            Already have an account?{" "}
            <a onClick={() => navigate("/login")} style={{ cursor: "pointer" }}>
              Log in
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
