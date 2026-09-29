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
    desc: "The terminal UI is @knightcode/tui. The same agent also runs in print, JSON, and RPC modes.",
  },
  {
    icon: CpuIcon,
    title: "Many providers",
    desc: "API keys, OAuth, and local endpoints. OpenRouter is one provider, alongside Anthropic, OpenAI, Google, xAI, and others.",
  },
  {
    icon: AiIdeaIcon,
    title: "Built-in tools",
    desc: "read, bash, edit, and write by default. grep, find, and ls on request. They run with the permissions of the KnightCode process.",
  },
  {
    icon: Notebook01Icon,
    title: "Project context",
    desc: "Skills, prompts, themes, and settings live under .knightcode and load after you trust the folder.",
  },
  {
    icon: CheckListIcon,
    title: "Session tree",
    desc: "Sessions are JSONL. Branch from an earlier message, or fork and clone history into a new file.",
  },
  {
    icon: PaintBrush02Icon,
    title: "Themes",
    desc: "system follows your terminal colors. dark and light are bundled, and a JSON file can add another palette.",
  },
  {
    icon: CodeFolderIcon,
    title: "Extensions",
    desc: "TypeScript modules can add tools, commands, providers, and UI. Packages install them from npm or git.",
  },
  {
    icon: Search01Icon,
    title: "Shell and git",
    desc: "bash is the shell tool. Status, diffs, logs, and checks run as commands you can read in the transcript.",
  },
  {
    icon: ShieldUserIcon,
    title: "Project trust",
    desc: "Trust decides whether a folder's settings, skills, and extensions load. It does not sandbox tool calls.",
  },
  {
    icon: RecordIcon,
    title: "Visible tool calls",
    desc: "Each read, search, edit, and command is shown as it runs. KnightCode does not ask before every tool call.",
  },
  {
    icon: EnergyIcon,
    title: "Compaction",
    desc: "A summary entry replaces older turns in the next model request. The original entries stay in the session.",
  },
  {
    icon: CommandIcon,
    title: "Session controls",
    desc: "/model, /thinking, /login, and /tools cover the model, reasoning level, credentials, and optional tools.",
  },
]

export function FeatureGrid() {
  return (
    <Section id="more">
      <div className="mx-auto max-w-3xl">
        <SectionEyebrow>07 - Toolkit</SectionEyebrow>
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
