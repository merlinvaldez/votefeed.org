import { useNavigate } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import "./LandingPage.css";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
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
          <h1>Welcome Back</h1>
          <p className="login-sub">Log in to track votes and comment.</p>
          <div className="login-form">
            <SignIn
              routing="path"
              path="/login"
              signUpUrl="/signup"
              forceRedirectUrl="/feed"
              fallbackRedirectUrl="/feed"
            ></SignIn>
          </div>
        </div>
      </section>
    </div>
  );
}
