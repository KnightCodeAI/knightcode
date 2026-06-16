import {
  AiIdeaIcon,
  CheckListIcon,
  CodeFolderIcon,
  CommandIcon,
  CpuIcon,
  EnergyIcon,
  Layout02Icon,
  Notebook01Icon,
  PaintBrush02Icon,
  RecordIcon,
  Search01Icon,
  ShieldUserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Section, SectionEyebrow, SectionHeading } from "./section"

const items = [
  {
    icon: Layout02Icon,
    title: "Interactive TUI",
    desc: "Run the coding assistant directly inside your terminal with React/OpenTUI screens and keyboard navigation.",
  },
  {
    icon: CpuIcon,
    title: "BYOK Model Routing",
    desc: "Use your own model key during onboarding and keep provider costs tied to the account you already control.",
  },
  {
    icon: AiIdeaIcon,
    title: "Agentic Workflows",
    desc: "Multi-step agents can read files, edit code, search codebases, and run shell commands with approval.",
  },
  {
    icon: Notebook01Icon,
    title: "Project Context",
    desc: "Keep rules, skills, memories, and task state close to the repository instead of isolated in a hosted chat.",
  },
  {
    icon: CheckListIcon,
    title: "Durable Task Suite",
    desc: "Track longer work through in-session todos and persistent .knightcode task files.",
  },
  {
    icon: PaintBrush02Icon,
    title: "TUI Customization",
    desc: "Adjust theme palettes (nord, tokyo-night, catppuccin, rose-pine) and export settings as JSON presets.",
  },
  {
    icon: CodeFolderIcon,
    title: "Lifecycle Hooks",
    desc: "Configure tool-use hooks to audit, block, or shape agent actions around your project rules.",
  },
  {
    icon: Search01Icon,
    title: "Git-aware Sessions",
    desc: "Ask the agent to inspect status, diffs, logs, and checks through the same shell tools you use manually.",
  },
  {
    icon: ShieldUserIcon,
    title: "Diagnostics Suite",
    desc: "Built-in /doctor command to audit your auth status, local server connection, and git repository setup.",
  },
  {
    icon: RecordIcon,
    title: "Visible Tool Calls",
    desc: "Review proposed edits, command output, and permission prompts as the agent works.",
  },
  {
    icon: EnergyIcon,
    title: "Context Compaction",
    desc: "Summarize long chat logs to keep extended coding sessions inside the model context window.",
  },
  {
    icon: CommandIcon,
    title: "CLI Control",
    desc: "Control reasoning levels (/reasoning) and configure execution guardrails with allowed commands (/allow).",
  },
]

export function FeatureGrid() {
  return (
    <Section id="more">
      <div className="mx-auto max-w-3xl">
        <SectionEyebrow>05 - Toolkit</SectionEyebrow>
        <SectionHeading>Practical pieces for real repo work.</SectionHeading>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.title}
            className="group relative bg-background/70 p-6 backdrop-blur-sm transition-colors hover:bg-background"
          >
            <div className="inline-flex size-8 items-center justify-center text-foreground/70 transition-colors group-hover:text-foreground">
              <HugeiconsIcon
                icon={it.icon}
                className="size-5"
                strokeWidth={1.6}
              />
            </div>
            <div className="mt-5 text-[15px] font-medium tracking-tight">
              {it.title}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {it.desc}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}
