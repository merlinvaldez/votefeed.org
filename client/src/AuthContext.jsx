import { createContext, useContext, useState, useCallback } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("token");
  });

  const setToken = (nextToken) => {
    setTokenState(nextToken);
    if (typeof window !== "undefined") {
      if (nextToken) {
        window.localStorage.setItem("token", nextToken);
      } else {
        window.localStorage.removeItem("token");
      }
    }
  };

  //   async function authFetch(url, options = {}) {
  //     const headers = new Headers(options.headers || {});
  //     if (token) {
  //       headers.set("Authorization", `Bearer ${token}`);
  //     }
  //     headers.set("Content-Type", "application/json");
  //     return fetch(url, { ...options, headers });
  //   }

  const authFetch = useCallback(
    async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      headers.set("Content-Type", "application/json");
      return fetch(url, { ...options, headers });
    },
    [token],
  );

  const value = { token, setToken, authFetch };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
