import { readFile } from "node:fs/promises"
import { join } from "node:path"

// The eye slit of public/knightcode-mark.svg. The mark cuts it out of the
// silhouette, so redrawing it on top lets the eye glow in the brand orange,
// like the full logo.
const EYE_PATH = "M5.49 5.05L5.9 4.46L7.11 3.98L6.51 4.76L5.49 5.07Z"

// The knight mark as a data URL for OG image routes. They run on the Node.js
// runtime so they can read it from disk; the path resolves from the app root.
export async function knightMark(fill: string) {
  const svg = (
    await readFile(join(process.cwd(), "public/knightcode-mark.svg"), "utf8")
  )
    .replaceAll('fill="black"', `fill="${fill}"`)
    .replace("</svg>", `<path d="${EYE_PATH}" fill="#ff6a00"/></svg>`)
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}
