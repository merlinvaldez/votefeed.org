import { useLocation, Navigate } from "react-router";

export default function RequireFeedData({ children }) {
  const { state } = useLocation();
  const hasData = state?.rep && state?.votes;
  return hasData ? children : <Navigate to="/" replace />;
}
