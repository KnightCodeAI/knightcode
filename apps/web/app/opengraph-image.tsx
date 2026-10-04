import { BRAND, knightMark, ogFonts } from "@/lib/og"
import { SITE, VERSION } from "@/lib/site"
import { ImageResponse } from "next/og"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = `${SITE.name} - ${SITE.tagline}`

// The card is a knight's move: the piece has just jumped g1 -> f3 on a board
// drawn as a terminal grid, and the orange L is the path it took. The long leg
// runs up into the knight's base so the knight hides none of it.
const SQ = 80
const BOARD = { left: 560, top: -10 } // bleeds off the top and bottom edges
const FILES = "abcdefgh"
const KNIGHT = 200
const LINE = 4
const GLOW = "0 0 18px 2px rgba(255,106,0,0.55)"

// Top-left corner of a square, from file index (a = 0) and rank (1-8).
const at = (file: number, rank: number) => ({
  x: BOARD.left + file * SQ,
  y: BOARD.top + (8 - rank) * SQ,
})
const g1 = at(6, 1)
const f1 = at(5, 1)
const f3 = at(5, 3)
const mid = SQ / 2

// Satori paints radial gradients opaque, so the vignette is done per square:
// full strength near the move, fading to nothing by FADE px away.
const FADE = { from: 150, to: 430 }
const fade = (x: number, y: number) => {
  const d = Math.hypot(x - (f3.x + mid), y - (f3.y + SQ))
  return Math.min(1, Math.max(0, (FADE.to - d) / (FADE.to - FADE.from)))
}

export default async function OG() {
  const [knight, fonts] = await Promise.all([knightMark("#fafafa"), ogFonts()])
  const mono = { fontFamily: "Geist Mono" }
  const fill = { position: "absolute", display: "flex" } as const

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "#000",
        color: "#fafafa",
        fontFamily: "Inter",
      }}
    >
      {/* Board */}
      {Array.from({ length: 64 }, (_, i) => {
        const file = i % 8
        const rank = 8 - Math.floor(i / 8)
        const { x, y } = at(file, rank)
        return (
          <div
            key={i}
            style={{
              ...fill,
              left: x,
              top: y,
              width: SQ,
              height: SQ,
              opacity: fade(x + mid, y + mid),
              border: "1px solid rgba(255,255,255,0.09)",
              background:
                (file + rank) % 2 === 0
                  ? "rgba(255,255,255,0.06)"
                  : "transparent",
            }}
          />
        )
      })}
      {[...FILES].map((f, i) => (
        <div
          key={f}
          style={{
            ...fill,
            ...mono,
            left: at(i, 1).x + SQ - 18,
            top: at(i, 1).y + SQ - 24,
            fontSize: 14,
            color: "#52525b",
            opacity: fade(at(i, 1).x + mid, at(i, 1).y + mid),
          }}
        >
          {f}
        </div>
      ))}

      {/* Landing square, origin ring, and the L: g1 -> f1, then up to f3 */}
      <div
        style={{
          ...fill,
          left: f3.x,
          top: f3.y,
          width: SQ,
          height: SQ,
          background: "rgba(255,106,0,0.14)",
          boxShadow: "0 0 80px 10px rgba(255,106,0,0.3)",
        }}
      />
      <div
        style={{
          ...fill,
          left: f1.x + mid - LINE / 2,
          top: g1.y + mid - LINE / 2,
          width: SQ + LINE,
          height: LINE,
          background: `linear-gradient(to left, rgba(255,106,0,0.3), ${BRAND})`,
          boxShadow: GLOW,
        }}
      />
      <div
        style={{
          ...fill,
          left: f1.x + mid - LINE / 2,
          top: f3.y + SQ,
          width: LINE,
          height: f1.y + mid + LINE / 2 - (f3.y + SQ),
          background: BRAND,
          boxShadow: GLOW,
        }}
      />
      <div
        style={{
          ...fill,
          left: g1.x + mid - 12,
          top: g1.y + mid - 12,
          width: 24,
          height: 24,
          borderRadius: 999,
          border: `3px solid ${BRAND}`,
          background: "#000",
        }}
      />

      {/* A solid left side so the text reads clean */}
      <div
        style={{
          ...fill,
          left: 0,
          top: 0,
          width: 900,
          height: 630,
          background:
            "linear-gradient(to right, #000 0%, #000 60%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* The knight, landed on f3 */}
      <img
        src={knight}
        alt=""
        width={KNIGHT}
        height={KNIGHT}
        style={{
          position: "absolute",
          left: f3.x + mid - KNIGHT / 2,
          top: f3.y + SQ - KNIGHT * (15.5 / 16),
        }}
      />

      {/* Text column */}
      <div
        style={{
          ...fill,
          left: 72,
          top: 64,
          width: 640,
          height: 630 - 64 - 60,
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={knight} alt="" width={40} height={40} />
          <div style={{ fontSize: 30, letterSpacing: -0.6 }}>{SITE.name}</div>
          <div
            style={{
              ...mono,
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: 6,
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              fontSize: 15,
              letterSpacing: 1.5,
              color: "#a1a1aa",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: BRAND,
              }}
            />
            V{VERSION}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 80,
              lineHeight: 1.04,
              letterSpacing: -3.4,
              color: "rgba(250,250,250,0.5)",
            }}
          >
            Agentic coding,
          </div>
          <div style={{ fontSize: 80, lineHeight: 1.04, letterSpacing: -3.4 }}>
            in your terminal.
          </div>
          <div
            style={{
              ...mono,
              display: "flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 14,
              marginTop: 36,
              padding: "14px 20px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              fontSize: 21,
              color: "#d4d4d8",
            }}
          >
            <span style={{ color: "#52525b" }}>$</span>
            npm i -g @knightcodeai/cli
          </div>
        </div>

        <div
          style={{
            ...mono,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 17,
            color: "#71717a",
          }}
        >
          <span style={{ color: BRAND }}>1. Nf3</span>
          <span>edit src/auth.ts</span>
          <span style={{ color: "#3f3f46" }}>/</span>
          <span>bun test</span>
          <span style={{ color: "#3f3f46" }}>/</span>
          <span style={{ color: "#a1a1aa" }}>12 passed</span>
        </div>
      </div>
    </div>,
    { ...size, fonts: [...fonts] }
  )
}
