import cliPackage from "../../../packages/cli/package.json"

export const VERSION = cliPackage.version
export const NPM_PACKAGE = "@knightcodeai/cli"
export const INSTALL_COMMAND = `npm i -g ${NPM_PACKAGE}`
export const RUN_COMMAND = "knightcode"

export const SITE = {
  name: "KnightCode",
  domain: "knightcode.raghavseth.in",
  url: "https://knightcode.raghavseth.in",
  tagline: "Agentic coding in your terminal",
  description:
    "KnightCode is an alpha-stage terminal AI coding app for developers. Install it from npm, bring your own model key, and keep agentic coding workflows close to your repo.",
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

