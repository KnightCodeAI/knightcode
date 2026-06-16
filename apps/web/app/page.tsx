// import { Demo } from "@/components/site/demo"
import { Download } from "@/components/site/download"
import { FAQ } from "@/components/site/faq"
import { FeatureGrid } from "@/components/site/feature-grid"
import { FeatureShowcase } from "@/components/site/feature-showcase"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { Hero } from "@/components/site/hero"
import { Stats } from "@/components/site/stats"
import { SITE, VERSION } from "@/lib/site"

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
  Mic01Icon,
  Notebook01Icon,
  PaintBrush02Icon,
  RecordIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    description: SITE.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Linux, Windows",
    softwareVersion: VERSION,
    downloadUrl: SITE.npm,
    url: SITE.url,
    license: "https://opensource.org/licenses/Apache-2.0",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Organization", name: SITE.name, url: SITE.github },
    /* video: {
      "@type": "VideoObject",
      name: `${SITE.name} - demo`,
      description: `Quick walkthrough of ${SITE.name}: terminal UI, repo-aware agents, approvals, and developer workflows.`,
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
        <Hero />
        <Stats />
        {/* <Demo /> */}

        <div id="features" className="relative">
          <FeatureShowcase
            id="terminal"
            index="01"
            eyebrow="Terminal App"
            title="A coding agent that lives where you already work."
            description="KnightCode runs as an interactive OpenTUI and React app in your terminal. Start sessions from a repository, keep project context nearby, and drive the agent without switching into a hosted web app."
            bullets={[
              {
                icon: CommandLineIcon,
                label: "Keyboard-driven React/OpenTUI terminal interface",
              },
              {
                icon: Layout02Icon,
                label: "Session views built around local workspace context",
              },
              {
                icon: CodeFolderIcon,
                label: "Themeable ANSI colors and responsive terminal layout",
              },
              {
                icon: Search01Icon,
                label: "Direct integration with local shells and repo tools",
              },
            ]}
            image={{
              src: "/terminal.webp",
              alt: "KnightCode terminal interface showing agent output and file structure",
              width: 2560,
              height: 1600,
              caption: "knightcode - terminal workspace",
            }}
            priority
          />

          <FeatureShowcase
            id="editor"
            index="02"
            eyebrow="Tool Approval"
            title="Review the work instead of trusting a black box."
            description="Agent actions are shown in the terminal flow. Inspect proposed file changes, shell commands, and task progress before letting KnightCode move forward."
            bullets={[
              { icon: CodeIcon, label: "Inline views for agent file operations and diffs" },
              {
                icon: CommandIcon,
                label: "Confirm or reject tool use as the agent works",
              },
              {
                icon: PaintBrush02Icon,
                label: "Keep edits and commands explicit in the session",
              },
              { icon: EnergyIcon, label: "Fast terminal UI designed for keyboard use" },
            ]}
            image={{
              src: "/editor.webp",
              alt: "KnightCode approval flow highlighting proposed agent code edits",
              width: 2560,
              height: 1600,
              caption: "knightcode - approval flow",
            }}
            reverse
          />

          <FeatureShowcase
            id="source-control"
            index="03"
            eyebrow="Repo Workflows"
            title="Let the agent read, search, edit, and run checks in context."
            description="KnightCode is built around real repositories, not isolated prompts. It can inspect files, search code, run commands, and use durable task state while you keep control of the terminal session."
            bullets={[
              {
                icon: GitBranchIcon,
                label: "Repo-aware tools for search, edits, and shell commands",
              },
              {
                icon: CommandIcon,
                label: "Approval-based command execution through local shells",
              },
              {
                icon: Layout02Icon,
                label: "Review and security-oriented prompts through agent workflows",
              },
              {
                icon: Search01Icon,
                label: "Use git status, diffs, logs, and checks from the session",
              },
            ]}
            image={{
              src: "/source-control.webp",
              alt: "KnightCode workflow showing repository commands and agent output",
              width: 2560,
              height: 1600,
              caption: "knightcode - repo workflow",
            }}
          />

          <FeatureShowcase
            id="agents"
            index="04"
            eyebrow="Agent Suite"
            title="Subagents, checklists, and durable tasks for larger work."
            description="For more than one-shot edits, KnightCode supports agent delegation, in-session todos, and persistent task files under .knightcode so longer work can stay organized."
            bullets={[
              {
                icon: RecordIcon,
                label: "Ephemeral checklists and durable task tracking",
              },
              {
                icon: Notebook01Icon,
                label: "Project rules, memories, and local context files",
              },
              {
                icon: CodeFolderIcon,
                label: "Composable workflow snippets and skill support",
              },
              { icon: CpuIcon, label: "OpenRouter key onboarding with model selection" },
              {
                icon: Mic01Icon,
                label: "Diagnostic doctor audits to verify environment",
              },
            ]}
            image={{
              src: "/ai_workflow.webp",
              alt: "KnightCode agent suite managing tasks and running diagnostics",
              width: 2560,
              height: 1600,
              caption: "knightcode - agent tasks",
            }}
          />

          <FeatureShowcase
            id="control"
            index="05"
            eyebrow="Customization & Control"
            title="Stay in control of context, cost, and behavior."
            description="Pick models, tune reasoning behavior, configure guardrails, and compact long conversations so the agent stays useful across extended sessions."
            bullets={[
              {
                icon: BrowserIcon,
                label: "Compact conversation history for longer sessions",
              },
              {
                icon: Layout02Icon,
                label: "Control reasoning behavior from the terminal UI",
              },
              {
                icon: CheckListIcon,
                label: "Tool-use hooks for project-specific guardrails",
              },
              {
                icon: EnergyIcon,
                label: "Allow rules for repeated trusted command patterns",
              },
            ]}
            image={{
              src: "/web_preview.webp",
              alt: "KnightCode configuration showing model and session controls",
              width: 2560,
              height: 1600,
              caption: "knightcode - context and config",
            }}
            reverse
          />

          <FeatureShowcase
            id="themes"
            index="06"
            eyebrow="Themes"
            title="A terminal interface you can live in."
            description="Tune the interface for long sessions with bundled themes, terminal-friendly palettes, and keyboard-first dialogs."
            bullets={[
              {
                icon: PaintBrush02Icon,
                label: "Bundled themes including nord, tokyo-night, and catppuccin",
              },
              {
                icon: Image01Icon,
                label: "Custom theme presets and JSON settings",
              },
              {
                icon: CodeIcon,
                label: "Flexible sizing and scroll settings for terminal windows",
              },
              {
                icon: CommandIcon,
                label: "Keyboard-based theme selector dialog",
              },
            ]}
            image={{
              src: "/themes.webp",
              alt: "KnightCode theme selector menu inside terminal",
              width: 2560,
              height: 1600,
              caption: "knightcode - terminal themes",
            }}
          />
        </div>

        <FeatureGrid />
        <Download />
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
