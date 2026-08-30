import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { SITE } from "@/lib/site"

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE.name} stores locally and what leaves your machine.`,
  alternates: { canonical: `${SITE.url}/privacy` },
}

const updated = "May 2026"

export default function PrivacyPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Privacy"
        title="Privacy"
        lead="KnightCode is a local CLI workflow with bring-your-own-key model access. This page explains what is stored locally, what is sent to providers, and what the website may collect."
        meta={<span>Last updated - {updated}</span>}
      />

      <Prose>
        <h2>The short version</h2>
        <ul>
          <li>No KnightCode account is required.</li>
          <li>You configure your own provider key for model access.</li>
          <li>
            Agent prompts, file context, and tool results may be sent to the
            provider/model route you choose.
          </li>
          <li>
            Local settings, credentials, tasks, and logs may be stored on your
            machine for the CLI to work.
          </li>
        </ul>

        <h2>What KnightCode stores locally</h2>
        <ul>
          <li>
            <strong>Credentials and onboarding choices</strong>, including your
            OpenRouter key and optional search-provider configuration.
          </li>
          <li>
            <strong>Project task state</strong> in <code>.knightcode</code>{" "}
            files when durable tasks are used.
          </li>
          <li>
            <strong>Rules, skills, memories, and settings</strong> that you add
            for project or global context.
          </li>
          <li>
            <strong>Session output and logs</strong> needed for debugging or
            resuming work, depending on the command and feature in use.
          </li>
        </ul>

        <h2>What KnightCode sends over the network</h2>
        <p>
          KnightCode sends network requests only when a feature needs them:
        </p>
        <ul>
          <li>
            <strong>Model requests</strong> go through the provider route you
            configure. In the current alpha, that path is OpenRouter-first.
          </li>
          <li>
            <strong>Search requests</strong> may go to the search provider you
            configure, such as Brave or Tavily.
          </li>
          <li>
            <strong>Web fetch requests</strong> are made when you ask the agent
            to fetch a URL.
          </li>
        </ul>
        <p>
          Whatever context you send to a provider is governed by that provider&apos;s
          privacy policy and retention settings.
        </p>

        <h2>What the website collects</h2>
        <p>
          The website is hosted separately from the CLI. It may receive standard
          HTTP request logs from the host and uses Vercel Analytics to understand
          basic page traffic. Do not put secrets into website forms or URLs.
        </p>

        <h2>Third-party providers</h2>
        <p>
          KnightCode is BYOK. That means provider accounts, billing, retention,
          rate limits, and abuse monitoring are handled by the services you
          configure, not by a KnightCode-hosted account system.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes, the &ldquo;Last updated&rdquo; date at the top
          of the page changes with it. Material changes may also be mentioned in
          the changelog.
        </p>

        <h2>Contact</h2>
        <p>
          For questions or bug reports, please open an issue on our{" "}
          <Link href={SITE.github} target="_blank" rel="noreferrer">
            GitHub repository
          </Link>
          . For security concerns, please see our{" "}
          <Link href="/security">
            Security Policy
          </Link>
          .
        </p>
      </Prose>

      <div className="h-24 sm:h-32" />
    </PageShell>
  )
}
