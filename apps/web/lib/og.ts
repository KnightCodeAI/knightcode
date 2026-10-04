import { readFile } from "node:fs/promises"
import { join } from "node:path"

// Shared by the OG image routes. They run on the Node.js runtime so they can
// read these from disk; paths resolve from the app root, as Next documents.

export const BRAND = "#ff6a00"

// The eye slit of public/knightcode-mark.svg. The mark cuts it out of the
// silhouette, so redrawing it on top lets the eye glow in the brand colour,
// like the full logo.
const EYE_PATH = "M5.49 5.05L5.9 4.46L7.11 3.98L6.51 4.76L5.49 5.07Z"

export async function knightMark(fill: string, eye = BRAND) {
  const svg = (
    await readFile(join(process.cwd(), "public/knightcode-mark.svg"), "utf8")
  )
    .replaceAll('fill="black"', `fill="${fill}"`)
    .replace("</svg>", `<path d="${EYE_PATH}" fill="${eye}"/></svg>`)
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

export async function ogFonts() {
  const font = (file: string) =>
    readFile(join(process.cwd(), "assets/og", file))
  const [inter, mono] = await Promise.all([
    font("inter-600.ttf"),
    font("geist-mono-400.ttf"),
  ])
  return [
    { name: "Inter", data: inter, weight: 600, style: "normal" },
    { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
  ] as const
}
