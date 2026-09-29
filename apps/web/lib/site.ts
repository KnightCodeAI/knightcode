import cliPackage from "../../../packages/cli/package.json"

// Build-time version. Prefer the live value from getLatestVersion(); this
// remains as the fallback and for any non-async render path. Defined here (not
// in version.ts) so client components and the edge OG route can read the
// version without pulling in version.ts's async changelog/registry fetches.
export const VERSION = cliPackage.version
export const FALLBACK_VERSION = VERSION
export const NPM_PACKAGE = "@knightcodeai/cli"
export const INSTALL_COMMAND = `npm install -g --ignore-scripts ${NPM_PACKAGE}`
export const RUN_COMMAND = "knightcode"

export const SITE = {
  name: "KnightCode",
  domain: "knightcode.dev",
  url: "https://knightcode.dev",
  tagline: "Agentic coding in your terminal",
  description:
    "KnightCode is a local, bring-your-own-key terminal coding agent. Install it from npm, connect a provider you already have, and run it in your repository.",
  github: "https://github.com/KnightCodeAI/knightcode",
  githubReleases: "https://github.com/KnightCodeAI/knightcode/releases",
  issues: "https://github.com/KnightCodeAI/knightcode/issues",
  me: "https://github.com/Raghav1428",
  websiteRepo: "https://github.com/KnightCodeAI/knightcode",
  npm: "https://www.npmjs.com/package/@knightcodeai/cli",
  demoVideoId: "kykgXa7sm1g",
  demoVideoUrl: "https://youtu.be/kykgXa7sm1g",
  youtube: "https://www.youtube.com/@Raghav1428",
} as const

export const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/ide", label: "IDE" },
  { href: "/about", label: "About" },
  { href: "/changelog", label: "Changelog" },
  { href: "/#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
] as const

export const PRODUCT_LINKS = [
  { label: "Install", href: "/#download" },
  { label: "Desktop IDE", href: "/ide" },
  { label: "Features", href: "/#features" },
  { label: "Changelog", href: "/changelog" },
  { label: "About", href: "/about" },
  { label: "Docs", href: "/docs" },
] as const

