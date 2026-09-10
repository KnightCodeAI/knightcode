"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { ChromaFlow, FilmGrain, FlutedGlass, Shader, Swirl } from "shaders/react"

/** Site accent, also used for small ink details in the hero. */
export const BRAND_ORANGE = "#ff6a00"

const PALETTE = {
  dark: {
    swirlA: "#0a0b0d",
    swirlB: "#1b1108",
    base: "#0a0b0d",
    down: BRAND_ORANGE,
    up: "#ffcc66",
    left: "#ffab3d",
    right: "#ff3d00",
  },
  light: {
    swirlA: "#ffffff",
    swirlB: "#fdf2e8",
    base: "#ffffff",
    down: BRAND_ORANGE,
    up: "#ffc46b",
    left: "#ffab3d",
    right: "#ff8a1f",
  },
}

/**
 * Fluted-glass background: a cursor-following bloom (ChromaFlow) refracted
 * through drifting diagonal ribs. Client-only — it needs WebGPU.
 */
export default function ShaderCanvas() {
  const { resolvedTheme } = useTheme()
  const [reducedMotion, setReducedMotion] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  const c = PALETTE[resolvedTheme === "light" ? "light" : "dark"]

  // No WebGPU: fall back to a static bloom so the site keeps its warmth.
  if (unavailable) {
    return (
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 60% 55% at 50% 0%, ${BRAND_ORANGE}22, transparent 70%)`,
        }}
      />
    )
  }

  return (
    <Shader
      onUnavailable={() => setUnavailable(true)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    >
      <Swirl colorA={c.swirlA} colorB={c.swirlB} detail={1.7} />
      <ChromaFlow
        baseColor={c.base}
        downColor={c.down}
        leftColor={c.left}
        rightColor={c.right}
        upColor={c.up}
        momentum={13}
        radius={3.5}
      />
      <FlutedGlass
        aberration={0.61}
        angle={31}
        frequency={8}
        highlight={0.12}
        highlightSoftness={0}
        lightAngle={-90}
        refraction={4}
        shape="rounded"
        softness={1}
        speed={reducedMotion ? 0 : 0.15}
      />
      <FilmGrain strength={0.05} />
    </Shader>
  )
}
