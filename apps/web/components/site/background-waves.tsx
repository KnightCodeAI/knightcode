"use client"

import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import LineWaves from "../line-waves"

export function BackgroundWaves() {
  const { resolvedTheme } = useTheme()
  const pathname = usePathname()
  const isDark = resolvedTheme !== "light"

  // The shader normalizes coords to the viewport without aspect correction, so
  // a fixed rotation looks far steeper on a tall phone than on a wide desktop.
  // Use a gentler angle on narrow screens to keep the same visual diagonal.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(max-width: 640px)")
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  if (pathname?.startsWith("/docs")) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0">
        <LineWaves
          rotation={isMobile ? -13 : -38}
          speed={0.35}
          warpIntensity={isMobile ? 0.22 : 0.3}
          innerLineCount={isMobile ? 26 : 40}
          outerLineCount={isMobile ? 12 : 15}
          edgeFadeWidth={0}
          colorCycleSpeed={0}
          brightness={isDark ? 0.35 : 0.1}
          color1="#D77757"
          color2={isDark ? "#B5603F" : "#E8A088"}
          color3={isDark ? "#1A1A1A" : "#C9A090"}
          enableMouseInteraction
          mouseInfluence={1.6}
        />
      </div>
      {/* Light mode only: a uniform veil of the background color over the
          waves so mid-tone text stays readable. Dark mode is left untouched. */}
      {!isDark && <div className="absolute inset-0 bg-background/55" />}
      {/* Top + bottom fade so content remains readable */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
      {/* Center vignette to anchor content */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,var(--background)_92%)] opacity-70"
        style={{ ["--background" as never]: "var(--background)" }}
      />
    </div>
  )
}
