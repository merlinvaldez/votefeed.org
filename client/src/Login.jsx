import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SignIn, useAuth } from "@clerk/clerk-react";
import "./LandingPage.css";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/feed", { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  if (isLoaded && isSignedIn) return null;

  return (
    <div className="login-layout">
      <section className="hero">
        <Link to="/feed" className="logo-lockup" aria-label="VoteFeed feed">
          <span className="logo-mark">
            <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
          </span>
          <span className="logo-text">VoteFeed</span>
        </Link>
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
