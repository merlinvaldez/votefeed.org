import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";
import AddressFields, {
  formatAddress,
  validateAddressFields,
} from "./AddressFields.jsx";
import "./LandingPage.css";
import "./Login.css";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, authFetch } = useAuth();
  const [pageStatus, setPageStatus] = useState("checking");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [routeError, setRouteError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate("/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const response = await authFetch(`${API_BASE}/users/me`);
        if (response.status === 401) {
          return;
        }
        if (!response.ok) {
          if (!cancelled)
            setRouteError(
              "We could not verify your account status. You can still continue onboarding.",
            );
          return;
        }
        if (response.ok) {
          const me = await response.json();
          if (me?.state && me?.district) {
            navigate("/feed", { replace: true });
            return;
          }
        }
      } catch {
        if (!cancelled)
          setRouteError(
            "We could not verify your account status. You can still continue onboarding.",
          );
      } finally {
        if (!cancelled) setPageStatus("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, authFetch, navigate]);

  if (!isLoaded || pageStatus === "checking") {
    return <div className="feed-loading">Loading...</div>;
  }

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
    setStatus("loading");
    setError("");
    try {
      const response = await authFetch(`${API_BASE}/users/me/onboarding`, {
        method: "POST",
        body: JSON.stringify({
          address,
          email: user?.primaryEmailAddress?.emailAddress ?? "",
          first_name: user?.firstName ?? "",
          last_name: user?.lastName ?? "",
        }),
      });
      if (response.status === 409) {
        window.sessionStorage.setItem("signup_error", "email_exists");
        await signOut({ redirectUrl: `${window.location.origin}/signup` });
        return;
      }
      if (!response.ok)
        throw new Error((await response.text()) || "Onboarding failed");
      navigate("/feed", { replace: true });
    } catch (err) {
      setError(err.message || "Onboarding failed");
    } finally {
      setStatus("idle");
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
        <div className="hero-footer">&copy; 2025 VoteFeed Inc.</div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h1>You&apos;re almost there...Let&apos;s find your district!</h1>
          <p className="login-sub">
            Enter your address so we can find your district. We do not save your
            address in our databases.
          </p>
          {routeError && <div className="error">{routeError}</div>}
          <form onSubmit={handleSubmit} className="login-form">
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
            />
            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Saving..." : "Continue to Feed"}
            </button>
            {error && <div className="error">{error}</div>}
          </form>
        </div>
      </section>
    </div>
  );
}
