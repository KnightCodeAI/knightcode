"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Matches a CSS media query. Server and first client render both report
 * `false`, so anything gated on this mounts after hydration - which is the
 * point for desktop-only widgets: phones never run or download them.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    [query]
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
