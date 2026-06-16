import { GithubIcon, ShieldUserIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { Button } from "@/components/ui/button"
import { SITE, VERSION } from "@/lib/site"

export const metadata: Metadata = {
  title: "Security",
  description: `How to report security issues in ${SITE.name}, what is in scope, and how the alpha handles risk.`,
  alternates: { canonical: `${SITE.url}/security` },
}

export default function SecurityPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Security"
        title="Security"
        lead="KnightCode is a local CLI that can read files, write files, run commands, and talk to AI providers. If you find a security issue, please report it privately first."
        meta={
          <>
            <span>Latest - v{VERSION}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>Alpha support - latest release</span>
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
          Until <code>1.0.0</code>, only the latest published alpha is expected
          to receive security fixes.
        </p>

        <h2>What is in scope</h2>
        <ul>
          <li>
            The CLI in <code>packages/cli</code>, especially tool execution,
            onboarding, credentials, model calls, terminal rendering, and agent
            permissions.
          </li>
          <li>
            Shared tool schemas and model metadata in <code>packages/shared</code>.
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
            Provider-side behavior from OpenRouter, search APIs, or other
            services you configure.
          </li>
          <li>
            Anything requiring an already-compromised local machine or a user
            intentionally approving a destructive command.
          </li>
        </ul>

        <h2>How KnightCode reduces risk</h2>
        <ul>
          <li>
            <strong>Explicit tool flow.</strong> File edits, shell commands, web
            fetches, and subagent work are visible in the terminal session.
          </li>
          <li>
            <strong>Approval and allow rules.</strong> Repeated command patterns
            can be controlled instead of silently executed.
          </li>
          <li>
            <strong>Local project state.</strong> Task files and rules live near
            the repository, making them inspectable.
          </li>
          <li>
            <strong>BYOK model access.</strong> KnightCode does not run a hosted
            model proxy for your code.
          </li>
        </ul>

        <h2>What we cannot promise</h2>
        <ul>
          <li>
            KnightCode can run powerful local actions when you approve them. Use
            source control and review the work.
          </li>
          <li>
            Providers see whatever context you send them. Review their retention
            and training policies.
          </li>
          <li>
            Alpha releases may change quickly. Keep the CLI updated and report
            suspicious behavior.
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
