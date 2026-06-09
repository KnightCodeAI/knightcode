import { useEffect, useMemo } from "react";
import { VERSION } from "../lib/version";
import {
  getAvailableUpdate,
  maybeRefreshUpdateCache,
} from "../lib/update/check";

/** Latest available version string if an update is cached, else null. */
export function useUpdateCheck(): string | null {
  // Derived from the cache read once on mount — it never changes, so it is a
  // memo, not state.
  const available = useMemo(() => getAvailableUpdate(VERSION), []);
  useEffect(() => {
    maybeRefreshUpdateCache();
  }, []);
  return available;
}
