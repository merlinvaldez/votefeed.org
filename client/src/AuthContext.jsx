import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import useClerkAuthFetch from "./useClerkAuthFetch";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { isSignedIn } = useClerkAuth();
  const authFetch = useClerkAuthFetch();

  const value = useMemo(
    () => ({ isSignedIn, authFetch }),
    [isSignedIn, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  return useContext(AuthContext);
}
