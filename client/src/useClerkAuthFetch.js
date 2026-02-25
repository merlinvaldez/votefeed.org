import { useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";

export default function useClerkAuthFetch() {
  const { getToken } = useAuth();

  const authFetch = useCallback(
    async (url, options = {}) => {
      const token = await getToken();
      const headers = new Headers(options.headers || {});
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(url, { ...options, headers });
    },
    [getToken],
  );
  return authFetch;
}
