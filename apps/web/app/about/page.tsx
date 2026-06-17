import { CodeIcon, GithubIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { Button } from "@/components/ui/button"
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"

export const metadata: Metadata = {
  title: "About",
  description: `What ${SITE.name} is, who builds it, and how it's put together.`,
  alternates: { canonical: `${SITE.url}/about` },
}

const stack = [
  { label: "Bun", note: "CLI runtime and package scripts" },
  { label: "React + OpenTUI", note: "Terminal interface" },
  { label: "AI SDK", note: "Streaming model calls" },
  { label: "OpenRouter", note: "Current BYOK model route" },
  { label: "Shared tool schemas", note: "Agent permissions and actions" },
]

export default async function AboutPage() {
  const version = await getLatestVersion()
  return (
    <PageShell>
      <PageHero
        eyebrow="About"
        title="About KnightCode"
        lead="An alpha-stage terminal coding app built with Bun, React, and OpenTUI. Install it from npm, bring your own model key, and run it inside the repo you are working on."
        meta={
          <>
            <span>v{version}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>Apache-2.0</span>
          </>
        }
      />

      <Prose>
        <h2>What it is</h2>
        <p>
          KnightCode is a terminal-first AI coding app for developers who want
          agentic workflows without moving into a hosted web interface. It runs
          as a CLI, renders an interactive terminal UI, and gives the agent
          access to repo-aware tools such as file reads, edits, search, shell
          commands, todos, tasks, and subagents.
        </p>
        <p>
          The current alpha is BYOK-first. Onboarding is built around your own
          OpenRouter key and model choice, so KnightCode does not bundle model
          usage or require a KnightCode account.
        </p>

        <h2>Who builds it</h2>
        <p>
          Mostly me -{" "}
          <Link href={SITE.me} target="_blank" rel="noreferrer">
            Raghav
          </Link>
          . KnightCode started as a side project because I wanted a
          free to use coding agent that felt native to the terminal instead
          of pasted beside it. It&apos;s still early, but the direction is clear:
          repo context, explicit tool use, and practical workflows.
        </p>
        <p>
          Contributions, bug reports, and feature requests are welcome on{" "}
          <Link href={SITE.github} target="_blank" rel="noreferrer">
            GitHub
          </Link>
          .
        </p>

        <h2>How it&apos;s built</h2>
        <p>
          Bun runs the CLI package and scripts. React drives the terminal
          interface through OpenTUI. The shared package defines model metadata
          and agent tools, while the CLI handles onboarding, streaming model
          calls, permissions, task state, and terminal interaction.
        </p>
      </Prose>

      <section className="relative mt-16 px-4 sm:mt-20 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm">
            {stack.map((s) => (
              <li
                key={s.label}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <HugeiconsIcon
                    icon={CodeIcon}
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                  <span className="text-sm font-medium">{s.label}</span>
                </div>
                <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                  {s.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Prose className="mt-16">
        <h2>What it isn&apos;t</h2>
        <ul>
          <li>
            It isn&apos;t a hosted service. There&apos;s no KnightCode account.
          </li>
          <li>
            It isn&apos;t a bundled AI subscription. Provider usage is handled
            through your own key.
          </li>
          <li>
            It isn&apos;t a replacement for your core shell. KnightCode is an
            additive coding workflow that can run commands with your approval.
          </li>
        </ul>

        <h2>License</h2>
        <p>
          Apache-2.0. Use it, fork it, ship it. The full license is in the{" "}
          <Link
            href={`${SITE.github}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            repo
          </Link>
          .
        </p>
      </Prose>

      <section className="relative mt-20 mb-24 px-4 sm:mt-24 sm:mb-32 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link href={SITE.github} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
              GitHub
            </Link>
          </Button>
        </div>
      </section>
    </PageShell>
  )
}
