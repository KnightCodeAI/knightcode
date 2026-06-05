import { useEffect, useState } from "react";
import { VERSION } from "../lib/version";
import {
  getAvailableUpdate,
  maybeRefreshUpdateCache,
} from "../lib/update/check";

/** Latest available version string if an update is cached, else null. */
export function useUpdateCheck(): string | null {
  const [available] = useState(() => getAvailableUpdate(VERSION));
  useEffect(() => {
    maybeRefreshUpdateCache();
  }, []);
  return available;
}
