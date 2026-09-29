// import { Demo } from "@/components/site/demo"
import { Download } from "@/components/site/download"
import { FAQ } from "@/components/site/faq"
import { FeatureGrid } from "@/components/site/feature-grid"
import { FeatureShowcase } from "@/components/site/feature-showcase"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { Hero } from "@/components/site/hero"
import { Stats } from "@/components/site/stats"
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"

import {
  BrowserIcon,
  CheckListIcon,
  CodeFolderIcon,
  CodeIcon,
  CommandIcon,
  CommandLineIcon,
  CpuIcon,
  EnergyIcon,
  GitBranchIcon,
  Image01Icon,
  Layout02Icon,
  Notebook01Icon,
  PaintBrush02Icon,
  RecordIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

export default async function HomePage() {
  const version = await getLatestVersion()
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    description: SITE.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Linux, Windows",
    softwareVersion: version,
    downloadUrl: SITE.npm,
    url: SITE.url,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Organization", name: SITE.name, url: SITE.github },
    /* video: {
      "@type": "VideoObject",
      name: `${SITE.name} - demo`,
      description: `Quick walkthrough of ${SITE.name}: terminal UI, provider sign-in, and repo tools.`,
      thumbnailUrl: `https://i.ytimg.com/vi/${SITE.demoVideoId}/maxresdefault.jpg`,
      uploadDate: "2026-05-16",
      contentUrl: SITE.demoVideoUrl,
      embedUrl: `https://www.youtube-nocookie.com/embed/${SITE.demoVideoId}`,
    }, */
  }

  return (
    <>
      <SiteHeader />
      <main className="relative">
        <Hero version={version} />
        <Stats />
        {/* <Demo /> */}

        <div id="features" className="relative">
          <FeatureShowcase
            id="terminal"
            index="01"
            eyebrow="Terminal"
            title="A coding agent that runs in your terminal."
            description="KnightCode's interface is its own terminal UI. Start it in a folder and that folder supplies files, instructions, and saved sessions. The same agent also runs in print, JSON, and RPC modes, and inside another program through the TypeScript SDK."
            bullets={[
              {
                icon: CommandLineIcon,
                label: "Interactive terminal UI, plus print, JSON, and RPC",
              },
              {
                icon: Layout02Icon,
                label: "Transcript, editor, and a footer for folder, model, and context",
              },
              {
                icon: CodeFolderIcon,
                label: "Works in the folder you opened, on macOS, Linux, and Windows",
              },
              {
                icon: Search01Icon,
                label: "Node.js 22 or newer for the npm install",
              },
            ]}
            image={{
              src: "/screens/terminal.webp",
              alt: "KnightCode terminal UI after a prompt: read and bash tool calls, then the model's answer",
              width: 1876,
              height: 1761,
              caption: "knightcode - terminal workspace",
            }}
            priority
          />

          <FeatureShowcase
            id="editor"
            index="02"
            eyebrow="Tools"
            title="You see each tool call. They run with your permissions."
            description="KnightCode shows every file read, search, command, and edit in the transcript. It does not ask before every tool call. It starts with read, bash, edit, and write. grep, find, and ls are built in and off until you enable them. Every tool uses the permissions of the KnightCode process."
            bullets={[
              { icon: CodeIcon, label: "read, bash, edit, and write by default. grep, find, and ls on request" },
              {
                icon: CommandIcon,
                label: "Project trust loads settings, skills, and extensions. It does not sandbox tools",
              },
              {
                icon: PaintBrush02Icon,
                label: "An optional classifier gate can hold a risky shell command or edit",
              },
              { icon: EnergyIcon, label: "Sandbox untrusted work. The agent is not a sandbox" },
            ]}
            image={{
              src: "/screens/tools.webp",
              alt: "KnightCode transcript showing a read, an edit with a red and green diff, and a git diff",
              width: 1876,
              height: 1674,
              caption: "knightcode - tool calls",
            }}
            reverse
          />

          <FeatureShowcase
            id="source-control"
            index="03"
            eyebrow="Sessions"
            title="Sessions are a tree you can branch, fork, and compact."
            description="A session is a JSONL file. Each entry points at its parent, so you can continue from an earlier message and keep the other branch. Compaction summarizes older turns for the next model request and leaves the original entries in the file."
            bullets={[
              {
                icon: GitBranchIcon,
                label: "Resume a folder's latest session, or branch from an earlier entry",
              },
              {
                icon: CommandIcon,
                label: "Fork and clone copy history into a new session file",
              },
              {
                icon: Layout02Icon,
                label: "The same session mechanism backs every mode",
              },
              {
                icon: Search01Icon,
                label: "Git status, diffs, logs, and checks run through bash",
              },
            ]}
            image={{
              src: "/screens/sessions.webp",
              alt: "KnightCode session tree with two branches that fork after the first reply",
              width: 1876,
              height: 1369,
              caption: "knightcode - session tree",
            }}
          />

          <FeatureShowcase
            id="agents"
            index="04"
            eyebrow="Providers"
            title="Bring the provider account you already have."
            description="Sign in with /login or set an API key. Built-in providers include OpenRouter, Anthropic, OpenAI, Google, xAI, Groq, GitHub Copilot, and Amazon Bedrock, plus llama.cpp and other OpenAI-compatible servers. Requests go to the provider you selected."
            bullets={[
              {
                icon: RecordIcon,
                label: "API keys, OAuth subscriptions, and ambient cloud credentials",
              },
              {
                icon: Notebook01Icon,
                label: "/model picks a model. /thinking sets the reasoning level",
              },
              {
                icon: CodeFolderIcon,
                label: "Local GGUF files through llama.cpp, or a compatible endpoint in models.json",
              },
              { icon: CpuIcon, label: "OpenRouter is one route, alongside direct providers" },
            ]}
            image={{
              src: "/screens/providers.webp",
              alt: "KnightCode provider picker opened with /login",
              width: 1876,
              height: 1152,
              caption: "knightcode - /login",
            }}
          />

          <FeatureShowcase
            id="control"
            index="05"
            eyebrow="Extensions"
            title="Skills, extensions, and packages sit next to the repo."
            description="Extensions are TypeScript modules loaded into the KnightCode process. They can add tools, commands, providers, and UI. Skills are instructions loaded when the model needs them. Packages install those resources from npm or git. Subagents ship as an example extension."
            bullets={[
              {
                icon: BrowserIcon,
                label: "Project resources under .knightcode load after you trust the folder",
              },
              {
                icon: Layout02Icon,
                label: "Prompt templates, themes, and skills",
              },
              {
                icon: CheckListIcon,
                label: "npm and git packages, tried once with -e or saved in settings",
              },
              {
                icon: EnergyIcon,
                label: "The measured system-prompt floor is about 1,100 tokens",
              },
            ]}
            image={{
              src: "/screens/extensions.webp",
              alt: "KnightCode startup listing project skills, prompts, and an extension, with the extension command run",
              width: 1876,
              height: 1195,
              caption: "knightcode - project resources",
            }}
            reverse
          />

          <FeatureShowcase
            id="themes"
            index="06"
            eyebrow="Themes"
            title="The terminal's colors, or a palette of your own."
            description="The default theme is system. It builds KnightCode's colors from the terminal's foreground, background, and ANSI colors. dark and light are bundled. A JSON file can add another palette."
            bullets={[
              {
                icon: PaintBrush02Icon,
                label: "system, dark, and light",
              },
              {
                icon: Image01Icon,
                label: "One theme, or a light/dark pair that follows the terminal",
              },
              {
                icon: CodeIcon,
                label: "Custom themes from JSON, including themes shipped in a package",
              },
              {
                icon: CommandIcon,
                label: "Change the theme from /settings",
              },
            ]}
            image={{
              src: "/screens/themes.webp",
              alt: "KnightCode theme picker listing system, automatic, dark, and light",
              width: 1876,
              height: 1282,
              caption: "knightcode - /settings theme",
            }}
          />
        </div>

        <FeatureGrid />
        <Download version={version} />
        <FAQ />
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
