import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./authContext";
import { API_BASE } from "./constants";

export default function RequireOnboarding() {
  const { isLoaded, isSignedIn, authFetch } = useAuth();
  const location = useLocation();
  const [checkResult, setCheckResult] = useState(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await authFetch(`${API_BASE}/users/me`);
        if (response.status === 401 || response.status === 404) {
          if (!cancelled) {
            setCheckResult({
              authFetch,
              pathname: location.pathname,
              status: "ready",
              needsOnboarding: true,
            });
          }
          return;
        }
        if (!response.ok) {
          if (!cancelled) {
            setCheckResult({
              authFetch,
              pathname: location.pathname,
              status: "guest",
              needsOnboarding: false,
            });
          }
          return;
        }

        const me = await response.json();
        const missingDistrictData = !me?.state || me?.district == null;
        if (!cancelled) {
          setCheckResult({
            authFetch,
            pathname: location.pathname,
            status: "ready",
            needsOnboarding: missingDistrictData,
          });
        }
      } catch {
        if (!cancelled) {
          setCheckResult({
            authFetch,
            pathname: location.pathname,
            status: "guest",
            needsOnboarding: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, authFetch, location.pathname]);

  if (!isLoaded)
    return <div className="feed-loading">Loading...</div>;
  const isGuestAllowedRoute =
    location.pathname === "/feed" || location.pathname.startsWith("/bill/");
  if (!isSignedIn) {
    return isGuestAllowedRoute ? <Outlet /> : <Navigate to="/login" replace />;
  }

  const hasCurrentCheck =
    checkResult?.authFetch === authFetch &&
    checkResult?.pathname === location.pathname;
  if (!hasCurrentCheck)
    return <div className="feed-loading">Loading...</div>;
  if (checkResult.status === "guest") return <Navigate to="/login" replace />;
  if (checkResult.needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
