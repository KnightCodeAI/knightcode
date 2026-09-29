import { GithubIcon, ShieldUserIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { Button } from "@/components/ui/button"
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"

export const metadata: Metadata = {
  title: "Security",
  description: `How to report security issues in ${SITE.name}, and what is in scope.`,
  alternates: { canonical: `${SITE.url}/security` },
}

export default async function SecurityPage() {
  const version = await getLatestVersion()
  return (
    <PageShell>
      <PageHero
        eyebrow="Security"
        title="Security"
        lead="KnightCode is a local CLI that can read files, write files, run commands, and talk to AI providers. If you find a security issue, please report it privately first."
        meta={
          <>
            <span>Latest - v{version}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>Latest release</span>
          </>
        }
      />

      <div className="mx-auto mb-10 flex max-w-3xl items-center justify-center px-4 sm:px-6">
        <Button asChild size="sm" className="rounded-full">
          <Link href={`${SITE.github}/security/advisories/new`} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
            Report a vulnerability
          </Link>
        </Button>
      </div>

      <Prose>
        <h2>Reporting</h2>
        <p>
          Please report security issues privately using the <strong>GitHub Security Advisories</strong> feature:
        </p>
        <ul>
          <li>Go to our <Link href={`${SITE.github}/security/advisories/new`} target="_blank" rel="noreferrer">Security Advisories page</Link>.</li>
          <li>Explain the vulnerability, the potential impact, and steps to reproduce.</li>
          <li>Include relevant context such as version, OS, shell, runtime, and install method.</li>
        </ul>
        <p>
          By using GitHub&apos;s private vulnerability reporting, you help ensure the issue is resolved before it is disclosed publicly. Once a fix is available, we can credit you in the release notes unless you prefer to stay anonymous.
        </p>

        <h2>Supported versions</h2>
        <p>
          Security fixes go to the latest published release.
        </p>

        <h2>What is in scope</h2>
        <ul>
          <li>
            The CLI in <code>packages/cli</code>, and the packages it runs on:{" "}
            <code>ai</code>, <code>agent</code>, <code>tui</code>,{" "}
            <code>durable</code>, <code>protocol</code>, <code>client</code>,{" "}
            <code>server</code>, <code>tools</code>, and{" "}
            <code>session-backend-sqlite</code>. That includes tool execution,
            credentials, model calls, and terminal rendering.
          </li>
          <li>Website code that could expose users or misrepresent downloads.</li>
          <li>npm package publishing or release integrity for KnightCode.</li>
        </ul>

        <h2>What is not</h2>
        <ul>
          <li>
            Issues in upstream dependencies unless KnightCode needs a specific
            mitigation.
          </li>
          <li>
            Provider-side behavior from the model, search, or hosting service
            you configure.
          </li>
          <li>
            Anything that requires an already-compromised local machine.
          </li>
        </ul>

        <h2>How KnightCode reduces risk</h2>
        <ul>
          <li>
            <strong>Visible tool calls.</strong> Reads, edits, searches, and
            commands show up in the transcript as they run.
          </li>
          <li>
            <strong>Project trust.</strong> A folder&apos;s settings, skills,
            and extensions load only after a trust decision. Trust does not
            sandbox tool calls.
          </li>
          <li>
            <strong>Optional classifier gate.</strong> When enabled, it can hold
            a risky shell command or edit for confirmation, or block it in
            print and JSON modes.
          </li>
          <li>
            <strong>BYOK model access.</strong> KnightCode does not run a hosted
            model proxy for your code.
          </li>
        </ul>

        <h2>What we cannot promise</h2>
        <ul>
          <li>
            KnightCode can read, change, and execute files with your
            operating-system permissions, and it does not ask before every tool
            call. Use source control and read the transcript.
          </li>
          <li>
            Providers see whatever context you send them. Review their retention
            and training policies.
          </li>
          <li>
            Keep the CLI updated and report suspicious behavior.
          </li>
        </ul>
      </Prose>

      <section className="relative mt-16 mb-24 px-4 sm:mt-20 sm:mb-32 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 text-sm text-muted-foreground">
          <HugeiconsIcon
            icon={ShieldUserIcon}
            className="size-4"
            strokeWidth={1.8}
          />
          <span>
            Use the{" "}
            <Link
              href={`${SITE.github}/security/advisories/new`}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
            >
              GitHub security tab
            </Link>{" "}
            for private reports.
          </span>
        </div>
      </section>
    </PageShell>
  )
}
