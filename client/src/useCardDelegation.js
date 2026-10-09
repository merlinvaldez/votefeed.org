import { useEffect, useState } from "react";
import { API_BASE } from "./constants";
import { toCardDelegation } from "./cardMembers";

export default function useCardDelegation(rep, location) {
  const state = location?.state ?? rep?.state ?? null;
  const [lookup, setLookup] = useState(null);

  useEffect(() => {
    if (!state) return;
    const controller = new AbortController();
    async function loadSenators() {
      try {
        const response = await fetch(
          `${API_BASE}/reps/state/${encodeURIComponent(state)}/senators`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Failed to load Senators");
        const data = await response.json();
        if (!Array.isArray(data.senators)) {
          throw new Error("Invalid Senators response");
        }
        if (!controller.signal.aborted) {
          setLookup({ state, senators: data.senators, error: null });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLookup({ state, senators: [], error: error.message });
        }
      }
    }
    loadSenators();
    return () => controller.abort();
  }, [state]);

  const currentLookup = lookup?.state === state ? lookup : null;
  return {
    ...toCardDelegation(rep, currentLookup?.senators ?? []),
    delegationLoading: Boolean(state && !currentLookup),
    delegationError: currentLookup?.error ?? null,
  };
}
