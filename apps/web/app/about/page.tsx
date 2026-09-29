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
  { label: "Node.js 22", note: "Published npm install" },
  { label: "@knightcode/tui", note: "Terminal UI" },
  { label: "@knightcode/ai", note: "Providers, auth, streaming" },
  { label: "@knightcode/agent", note: "Loop, tools, compaction, sessions" },
  { label: "@knightcode/durable", note: "Pico record storage" },
  { label: "protocol / client / server", note: "RPC" },
  { label: "session-backend-sqlite", note: "SQLite session backend" },
  { label: "@knightcode/tools", note: "Optional tools and the classifier gate" },
  { label: "@knightcode/remote", note: "Remote sessions" },
]

export default async function AboutPage() {
  const version = await getLatestVersion()
  return (
    <PageShell>
      <PageHero
        eyebrow="About"
        title="About KnightCode"
        lead="A local, bring-your-own-key terminal coding agent. Install it from npm, run it in a repository, and connect a provider you already have."
        meta={
          <>
            <span>v{version}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>MIT</span>
          </>
        }
      />

      <Prose>
        <h2>What it is</h2>
        <p>
          KnightCode is a terminal coding agent. The <code>knightcode</code>{" "}
          command runs an interactive session, and the same agent is available
          in print, JSON, and RPC modes and through <code>createAgentSession()</code>.
          It starts with the read, bash, edit, and write tools; grep, find, and ls
          are built in and off until you enable them. Tools run with the
          permissions of the KnightCode process.
        </p>
        <p>
          You bring the provider account. <code>/login</code> stores a
          credential, or you set an API key in the environment. OpenRouter is
          one of the built-in providers, next to direct adapters for Anthropic,
          OpenAI, Google, xAI, Groq, GitHub Copilot, Amazon Bedrock, and others.
          There is no KnightCode account and no bundled model subscription.
        </p>

        <h2>Who builds it</h2>
        <p>
          Mostly me -{" "}
          <Link href={SITE.me} target="_blank" rel="noreferrer">
            Raghav
          </Link>
          . I built it because I wanted a coding agent that runs in the
          terminal, talks to the provider I already pay, and does not spend
          tens of thousands of tokens on its own instructions before I type.
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
          The published command is <code>@knightcodeai/cli</code>. It depends on
          the other packages in this repository. <code>@knightcode/ai</code>{" "}
          is the provider layer: catalogs, API adapters, OAuth, and streaming.
          <code>@knightcode/agent</code> is the loop, the harness, compaction,
          session state, and the built-in tools. <code>@knightcode/tui</code>{" "}
          draws the terminal. <code>@knightcode/durable</code> is the Pico
          record runtime, with memory, JSONL, and SQLite storage. RPC is split
          across <code>protocol</code>, <code>client</code>, and{" "}
          <code>server</code>. SQLite session storage lives in its own package
          so the agent core does not require it. <code>@knightcode/tools</code>{" "}
          is the built-in extension for optional tools, the scratchpad, and the
          classifier gate. <code>@knightcode/remote</code> is remote sessions.
          Bun runs the repo from source.
          The website is a separate Next.js app.
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
            It isn&apos;t a sandbox. Tools use the operating-system permissions
            of the process that started KnightCode. Project trust only decides
            whether a folder&apos;s settings, skills, and extensions load.
          </li>
        </ul>

        <h2>License</h2>
        <p>
          MIT. The license text, including third-party notices, is in the{" "}
          <Link
            href={`${SITE.github}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            repository
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
