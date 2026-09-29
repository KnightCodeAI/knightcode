"use client"

import {
  ArrowRight01Icon,
  CommandLineIcon,
  CpuIcon,
  GithubIcon,
  ShieldUserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { RUN_COMMAND, SITE, FALLBACK_VERSION } from "@/lib/site"
import { CommandBlock, InstallCommand } from "./install-command"
import { Section, SectionEyebrow, SectionHeading } from "./section"

const setupNotes = [
  {
    icon: CommandLineIcon,
    title: "Install from npm",
    desc: "Node.js 22 or newer. One global install exposes knightcode on macOS, Linux, and Windows. Lifecycle scripts are not required.",
  },
  {
    icon: CpuIcon,
    title: "Sign in to a provider",
    desc: "Run /login, or set an API key in the environment. OpenRouter, Anthropic, OpenAI, Google, xAI, and local servers are all built in.",
  },
  {
    icon: ShieldUserIcon,
    title: "Watch the transcript",
    desc: "File reads, searches, edits, and commands show up as they run. They use your operating-system permissions.",
  },
]

export function Download({ version = FALLBACK_VERSION }: { version?: string }) {
  return (
    <Section id="download" className="overflow-hidden border-t border-border/40">
      {/* Background visual accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-foreground/[0.015] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent_75%)]"
      />
      
      <div className="relative grid gap-12 lg:grid-cols-12 lg:gap-16 items-start">
        {/* Left Column: Title & Interactive Quick Start Card */}
        <div className="lg:col-span-6 flex min-w-0 flex-col gap-6">
          <div>
            <SectionEyebrow>08 - Install - v{version}</SectionEyebrow>
            <SectionHeading className="mt-2.5">
              Install the CLI. Open your repo. Start a session.
            </SectionHeading>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-[17px]">
              KnightCode is installed from npm. There is no KnightCode account: install the command, sign in to a provider, and run it in the folder you want to work on.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/30 p-4 backdrop-blur-md shadow-sm sm:p-6">
            <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/85 uppercase">
              Quick Start
            </div>
            
            <div className="mt-4">
              <div className="text-sm font-medium text-foreground/90">
                Install globally:
              </div>
              <InstallCommand className="mt-2.5" />
            </div>

            <div className="mt-5">
              <div className="text-sm font-medium text-foreground/90">
                Then launch it from any repository:
              </div>
              <CommandBlock
                command={RUN_COMMAND}
                className="mt-2.5 rounded-2xl border border-border/60 bg-card/40 shadow-sm backdrop-blur-md"
              />
            </div>

            <div className="mt-6 pt-5 border-t border-border/40">
              <Link
                href={SITE.github}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.15em] text-muted-foreground/80 uppercase transition-colors hover:text-foreground"
              >
                View source and setup notes
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-3"
                  strokeWidth={2}
                />
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Key Concepts Stack & GitHub Link */}
        <div className="lg:col-span-6 flex min-w-0 flex-col gap-6 lg:mt-2">
          <div className="space-y-6">
            {setupNotes.map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 p-4 rounded-xl transition-colors hover:bg-card/25"
              >
                <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-foreground">
                  <HugeiconsIcon
                    icon={item.icon}
                    className="size-5"
                    strokeWidth={1.8}
                  />
                </span>
                <div>
                  <div className="text-base font-semibold tracking-tight text-foreground/95">
                    {item.title}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-5 rounded-2xl border border-border/50 bg-card/20 backdrop-blur-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold tracking-tight text-foreground">
                  Follow development
                </div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Issues, source, and release notes are on GitHub.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="rounded-full shrink-0 cursor-pointer">
                <Link href={SITE.github} target="_blank" rel="noreferrer">
                  <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
                  GitHub
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
