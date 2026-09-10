"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"

// Client-only, and kept out of the initial bundle: the shader runtime is large
// and nothing above the fold waits on it.
const ShaderCanvas = dynamic(() => import("./shader-canvas"), { ssr: false })

export function BackgroundShader() {
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
        <ShaderCanvas />
      </div>
      {/* Light mode only: a uniform veil of the background color over the
          shader so mid-tone text stays readable. Dark mode is left untouched. */}
      {!isDark && <div className="absolute inset-0 bg-background/35" />}
      {/* Top + bottom fade so content remains readable */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
      {/* Center vignette to anchor content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,var(--background)_92%)] opacity-70" />
    </div>
  )
}
