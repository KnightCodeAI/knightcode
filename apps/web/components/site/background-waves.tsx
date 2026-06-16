"use client"

import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import LineWaves from "../line-waves"

export function BackgroundWaves() {
  const { resolvedTheme } = useTheme()
  const pathname = usePathname()
  const isDark = resolvedTheme !== "light"

  if (pathname?.startsWith("/docs")) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0">
        <LineWaves
          rotation={-38}
          speed={0.35}
          warpIntensity={0.3}
          innerLineCount={40}
          outerLineCount={15}
          edgeFadeWidth={0}
          colorCycleSpeed={0}
          brightness={isDark ? 0.35 : 0.18}
          color1="#D77757"
          color2={isDark ? "#B5603F" : "#E8A088"}
          color3={isDark ? "#1A1A1A" : "#C9A090"}
          enableMouseInteraction
          mouseInfluence={1.6}
        />
      </div>
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
