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
        <div className="login-card login-card--clerk">
          <button
            className="back-link"
            type="button"
            onClick={() => navigate("/")}
          >
            ← Back to Search
          </button>
          <div className="clerk-only">
            <SignIn
              routing="path"
              path="/login"
              signUpUrl="/signup"
              withSignUp={true}
              transferable={false}
              signUpFallbackRedirectUrl={"/signup"}
              fallbackRedirectUrl="/feed"
              appearance={{ elements: { card: "vf-clerk-card" } }}
            ></SignIn>
          </div>
        </div>
      </section>
    </div>
  );
}
