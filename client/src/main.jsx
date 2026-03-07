import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { ClerkProvider } from "@clerk/clerk-react";

function applyStoredTheme() {
  if (typeof window === "undefined") return;
  const storedTheme = window.localStorage.getItem("theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    document.documentElement.dataset.theme = storedTheme;
  }
}

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
console.log(
  "[preview-check] VITE_VERCEL_ENV =",
  import.meta.env.VITE_VERCEL_ENV,
); // Temporary runtime check: confirms the Vite-injected env value for this deployment.
console.log(
  "[preview-check] VITE_VERCEL_BRANCH_URL =",
  import.meta.env.VITE_VERCEL_BRANCH_URL,
); // Temporary runtime check: confirms branch URL var is present for preview host wiring.

if (!clerkKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in client env");
}

applyStoredTheme();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkKey}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ClerkProvider>
  </StrictMode>,
);
