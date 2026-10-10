import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { SITE } from "@/lib/site"

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE.name} stores locally and what leaves your machine.`,
  alternates: { canonical: `${SITE.url}/privacy` },
}

const updated = "September 2026"

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
            Credentials, sessions, settings, skills, and prompts are stored on
            your machine.
          </li>
        </ul>

        <h2>What KnightCode stores locally</h2>
        <ul>
          <li>
            <strong>Credentials</strong> in{" "}
            <code>~/.knightcode/agent/auth.json</code>, or in environment
            variables you set yourself. <code>tools.json</code> can also hold a
            Brave Search key when you turn web search on.
          </li>
          <li>
            <strong>Sessions</strong> as JSONL files, including messages, tool
            calls, and compaction summaries.
          </li>
          <li>
            <strong>Settings, skills, prompts, and themes</strong> under{" "}
            <code>~/.knightcode</code> and, after you trust a folder, under its{" "}
            <code>.knightcode</code> directory.
          </li>
        </ul>

        <h2>What KnightCode sends over the network</h2>
        <p>
          KnightCode sends network requests only when a feature needs them:
        </p>
        <ul>
          <li>
            <strong>Model requests</strong> go to the provider you selected.
            That can be OpenRouter, a direct provider such as Anthropic or
            OpenAI, a cloud account, or a server on your machine.
          </li>
          <li>
            <strong>Web search</strong>, when you enable <code>websearch</code>{" "}
            with <code>/tools</code>, goes to DuckDuckGo or Brave Search.
          </li>
          <li>
            <strong>Web fetch</strong>, when you enable <code>webfetch</code>,
            requests the URL the agent is fetching.
          </li>
          <li>
            <strong>Model catalog</strong> refreshes come from{" "}
            <code>knightcode.dev</code>. <code>--offline</code> or{" "}
            <code>KNIGHTCODE_OFFLINE=1</code> turns them off.
          </li>
          <li>
            <strong>Install and update ping.</strong> The first launch of a new
            version sends one anonymous request to <code>knightcode.dev</code>{" "}
            with the KnightCode version and a user agent that names your
            operating system, runtime, and CPU architecture. The site adds a
            coarse location (country, region, city) from the request and an
            anonymous ID made from a one-way hash of your IP address and user
            agent. It does not store the address. The ping is on by default. Turn it off
            with <code>enableInstallTelemetry: false</code> or{" "}
            <code>KNIGHTCODE_TELEMETRY=0</code>. The same setting controls the
            identifying headers KnightCode adds to requests for OpenRouter,
            NVIDIA NIM, and Cloudflare models.
          </li>
          <li>
            <strong>Bug reports</strong> are uploaded to KnightCode only when
            you run <code>/bug</code>.
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
