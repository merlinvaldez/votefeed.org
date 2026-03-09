import { useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { createContext, useContext, useCallback, useMemo } from "react";
import useClerkAuthFetch from "./useClerkAuthFetch";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { signOut } = useClerk();
  const authFetch = useClerkAuthFetch();
  const token = isSignedIn ? "clerk-session" : null;

  const setToken = useCallback(
    (nextToken) => {
      if (nextToken == null) {
        return signOut({ redirectUrl: "/login" });
      }
      return Promise.resolve(nextToken);
    },
    [signOut],
  );

  const value = useMemo(
    () => ({ isLoaded, isSignedIn, token, setToken, authFetch }),
    [isLoaded, isSignedIn, token, setToken, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  return useContext(AuthContext);
}
