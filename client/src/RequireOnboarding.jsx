import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE } from "./constants";

export default function RequireOnboarding() {
  const { isLoaded, isSignedIn, authFetch } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState("loading");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) {
      setStatus("loading");
      return () => {
        cancelled = true;
      };
    }
    const isGuestAllowedRoute =
      location.pathname === "/feed" || location.pathname.startsWith("/bill/");
    if (!isSignedIn) {
      setNeedsOnboarding(false);
      setStatus(isGuestAllowedRoute ? "ready" : "guest");
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const response = await authFetch(`${API_BASE}/users/me`);
        if (response.status === 401 || response.status === 404) {
          if (!cancelled) {
            setNeedsOnboarding(true);
            setStatus("ready");
          }
          return;
        }
        if (!response.ok) {
          if (!cancelled) setStatus("guest");
          return;
        }

        const me = await response.json();
        const missingDistrictData = !me?.state || !me?.district;
        if (!cancelled) {
          setNeedsOnboarding(missingDistrictData);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, authFetch, location.pathname]);

  if (!isLoaded || status === "loading")
    return <div className="feed-loading">Loading...</div>;
  if (status === "guest") return <Navigate to="/login" replace />;
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
