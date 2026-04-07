import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SignUp } from "@clerk/clerk-react";
import "./LandingPage.css";
import "./Login.css";

export default function Signup() {
  const navigate = useNavigate();
  const [showEmailExistsError, setShowEmailExistsError] = useState(false);

  useEffect(() => {
    const flag = window.sessionStorage.getItem("signup_error");
    if (flag === "email_exists") {
      setShowEmailExistsError(true);
      window.sessionStorage.removeItem("signup_error");
    }
  }, []);

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
        <div className="hero-footer">
          <div>&copy; 2025 VoteFeed Inc.</div>
          <div className="hero-footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card login-card--clerk">
          <button
            className="back-link"
            type="button"
            onClick={() => navigate("/")}
          >
            <span aria-hidden="true">&larr;</span>
            <span>Back to Search</span>
          </button>
          <div className="clerk-only">
            {showEmailExistsError && (
              <div className="error">
                An Account with that email already exists. Try signing in
                instead.
              </div>
            )}
            <SignUp
              routing="path"
              path="/signup"
              signInUrl="/login"
              forceRedirectUrl="/onboarding"
              fallbackRedirectUrl="/onboarding"
              signInForceRedirectUrl="/feed"
              signInFallbackRedirectUrl="/feed"
              appearance={{ elements: { card: "vf-clerk-card" } }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
