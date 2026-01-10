import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE } from "./constants";
import { useAuth } from "./AuthContext";
import "./LandingPage.css";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
  const { setToken, authFetch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim(),
        }),
      });
      if (!resp.ok) throw new Error((await resp.text()) || "Login failed");
      const token = await resp.text();
      setToken(token);

      const feedResp = await authFetch(`${API_BASE}/users/me/feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!feedResp.ok) throw new Error("Failed to load feed");
      const feed = await feedResp.json();

      navigate("/feed", { state: { ...feed, authed: true } });
      setStatus("success");
    } catch (err) {
      setError(err.message || "Login failed");
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
          <a className="back-link" onClick={() => navigate("/")}>
            ← Back to Search
          </a>
          <h1>Welcome Back</h1>
          <p className="login-sub">Log in to track votes and comment.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {/* <a className="forgot" href="#">
              Forgot?
            </a> */}
            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Logging in..." : "Log in"}
            </button>
            {error && <div className="error">{error}</div>}
          </form>

          <div className="login-footer">
            New here? <Link to="/signup">Create an account</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
