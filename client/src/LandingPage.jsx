import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { API_BASE } from "./constants.js";
import { useAuth } from "./AuthContext.jsx";
import AddressFields, {
  formatAddress,
  saveAddressDraft,
  validateAddressFields,
} from "./AddressFields.jsx";
import "./LandingPage.css";

function LandingPage() {
  const PAGE_SIZE = 5;
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const formatErrorMessage = (rawError) => {
    if (!rawError) return "";
    try {
      const parsed = JSON.parse(rawError);
      return parsed?.error || rawError;
    } catch {
      return rawError;
    }
  };

  const handleSignUpClick = () => {
    saveAddressDraft({ street, city, stateCode, zip });
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) navigate("/feed", { replace: true });
  }, [isLoaded, isSignedIn, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validateAddressFields({ street, city, stateCode, zip });
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setStatus("idle");
      setError("");
      return;
    }
    setFieldErrors({});

    const address = formatAddress({ street, city, stateCode, zip });

    setStatus(`loading`);
    setError("");

    try {
      const districtResp = await fetch(
        `${API_BASE}/districts?address=${encodeURIComponent(address)}`,
      );
      if (!districtResp.ok) {
        const msg = await districtResp.text();
        throw new Error(
          msg || `District lookup failed (${districtResp.status})`,
        );
      }
      const districtData = await districtResp.json();

      const repResp = await fetch(
        `${API_BASE}/reps/district/${districtData.state}/${districtData.congressionalDistrict}`,
      );
      if (!repResp.ok) {
        const msg = await repResp.text();
        throw new Error(msg || `Rep lookup failed (${repResp.status})`);
      }
      const repData = await repResp.json();
      setStatus("loading-votes");
      const repId = repData.bioguideid;
      const votesResp = await fetch(
        `${API_BASE}/housevotes/member/${repId}?limit=${PAGE_SIZE}&offset=0`,
      );
      if (!votesResp.ok) {
        const msg = await votesResp.text();
        throw new Error(
          msg || `Voting record lookup failed (${votesResp.status})`,
        );
      }
      const {
        votes = [],
        policyAreas = [],
        totalPolicyCount = 0,
        selectedPolicyArea = null,
      } = await votesResp.json();
      saveAddressDraft({ street, city, stateCode, zip });
      navigate("/feed", {
        state: {
          district: districtData,
          rep: repData,
          votes,
          policyAreas,
          totalPolicyCount,
          selectedPolicyArea,
        },
      });
      setStatus("success");
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

      <section className="form-panel">
        <div className="form-card">
          <div className="form-header">
            <h2>Find your District</h2>
            <p>Enter your address to see your Rep&apos;s voting record.</p>
          </div>
          <form className="address-form" onSubmit={handleSubmit}>
            <AddressFields
              street={street}
              setStreet={setStreet}
              city={city}
              setCity={setCity}
              stateCode={stateCode}
              setStateCode={setStateCode}
              zip={zip}
              setZip={setZip}
              fieldErrors={fieldErrors}
            ></AddressFields>
            <button
              type="submit"
              disabled={status === "loading" || status === "loading-votes"}
            >
              {buttonLabel}
            </button>

            {error && <div className="error">{formatErrorMessage(error)}</div>}
          </form>
        </div>
        <div className="account-card" aria-label="Account actions">
          <div className="account-copy">
            <h3>Share your voice</h3>
            <p>
              Create an account to interact with your rep's voting record and
              share your comments with their office.
            </p>
          </div>
          <div className="account-actions">
            <SignUpButton
              mode="modal"
              forceRedirectUrl="/onboarding"
              fallbackRedirectUrl="/onboarding"
              signInForceRedirectUrl="/feed"
              signInFallbackRedirectUrl="/feed"
            >
              <button
                type="button"
                className="account-action account-action-primary"
                onClick={handleSignUpClick}
              >
                Sign up
              </button>
            </SignUpButton>
            <SignInButton
              mode="modal"
              forceRedirectUrl="/feed"
              fallbackRedirectUrl="/feed"
              signUpForceRedirectUrl="/onboarding"
              signUpFallbackRedirectUrl="/onboarding"
            >
              <button
                type="button"
                className="account-action account-action-secondary"
              >
                Sign in
              </button>
            </SignInButton>
          </div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
