import { Alert02Icon, GithubIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"

import { IdeDownloads } from "@/components/site/ide-downloads"
import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { Button } from "@/components/ui/button"
import {
  type GithubRelease,
  guessPlatform,
  IDE_REPOSITORY,
  installersFor,
  PLATFORMS,
} from "@/lib/ide-release"
import { SITE } from "@/lib/site"

export const metadata: Metadata = {
  title: "Download the KnightCode IDE",
  description:
    "Installers for the KnightCode desktop IDE on Windows, macOS and Linux, with what each platform will warn you about and what to click.",
  alternates: { canonical: `${SITE.url}/ide` },
}

// The same release the IDE's own update check reads, so the page and the
// updater can never offer different versions.
const RELEASE_REVALIDATE_SECONDS = 300

async function latestRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${IDE_REPOSITORY}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "knightcode-website",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        next: { revalidate: RELEASE_REVALIDATE_SECONDS },
      }
    )
    if (!res.ok) return null
    return (await res.json()) as GithubRelease
  } catch {
    return null
  }
}

// Builds of one system share their steps.
const firstLaunch = [...new Map(PLATFORMS.map((p) => [p.os, p.instructions]))]

export default async function IdePage() {
  const release = await latestRelease()
  const downloads = release ? installersFor(release) : []
  const version = downloads[0]?.files.version ?? null
  // Guessed here rather than in the browser so the right build is in the
  // first paint; this makes the page render per request, but the release
  // fetch above stays cached.
  const request = await headers()
  const initialGuess = guessPlatform({
    userAgent: request.get("user-agent") ?? "",
    mobile: request.get("sec-ch-ua-mobile") === "?1",
  })

  return (
    <PageShell>
      <PageHero
        eyebrow="Desktop"
        title="KnightCode IDE"
        lead="A desktop editor with KnightCode as its only agent, its only inference path and its only login. The same sign-in serves the agent panel, inline assist, commit messages and Tab."
        meta={
          <>
            <span>{version ? `v${version}` : "Not yet released"}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>GPL-3.0-or-later</span>
          </>
        }
      />

      <section className="mx-auto w-full max-w-3xl px-6 pb-8">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 size-5 shrink-0 text-amber-500"
            />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                These installers are not code-signed.
              </p>
              <p className="mt-1">
                Windows SmartScreen and macOS Gatekeeper will both refuse the
                first launch and say so in language that reads like a malware
                warning. That is what an unsigned build looks like, not a
                verdict on the file. The first-launch steps below say exactly
                what you will see and what to click. Signing certificates cost
                money we have not spent yet; when that changes, these warnings
                go away.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-16">
        {downloads.length === 0 ? (
          <div className="rounded-lg border border-border/60 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              No published release yet.
            </p>
            <p className="mt-1">
              The installers appear here as soon as the first non-prerelease
              version is published. Until then, build it from source:{" "}
              <Link
                href={`https://github.com/${IDE_REPOSITORY}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                {IDE_REPOSITORY}
              </Link>
              .
            </p>
          </div>
        ) : (
          <IdeDownloads downloads={downloads} initialGuess={initialGuess} />
        )}

        {downloads.length > 0 && downloads.length < PLATFORMS.length && (
          <p className="mt-4 text-sm text-muted-foreground">
            Some platforms are missing from this release. They appear here when
            the next release carries them.
          </p>
        )}
      </section>

      <Prose>
        <h2>First launch</h2>
        {firstLaunch.map(([os, steps]) => (
          <p key={os}>
            <strong>{os}.</strong> {steps}
          </p>
        ))}

        <h2>After it starts</h2>
        <p>
          First run walks you through it: pick a theme and a keymap, sign in to
          the account you already have — Claude, ChatGPT, Copilot, or an API key
          — pick the model KnightCode should use, and open a folder. Nothing
          asks for a KnightCode account, because there is not one.
        </p>
        <p>
          If you already use the KnightCode CLI on the same machine, first run
          skips the sign-in step: both read the same <code>auth.json</code>, so
          you are already signed in.
        </p>

        <h2>Updates</h2>
        <p>
          The IDE checks for a new version hourly and installs it in the
          background, verifying a signature made with a key held only by the
          release workflow. Turn it off with{" "}
          <code>&quot;auto_update&quot;: false</code> in settings.
        </p>

        <h2>What it sends</h2>
        <p>
          One anonymous ping when it is installed or updated: version, operating
          system, architecture, and an approximate location from the connecting
          address. No account, no file, no project name, no identifier that
          follows you between versions. First run asks, and you can turn it off
          there or in Settings &rarr; AI at any time. Nothing else leaves the
          machine except your prompts, which go from your machine straight to
          the provider you signed in to.
        </p>

        <h2>Built on Zed</h2>
        <p>
          The editor is a fork of{" "}
          <Link
            href="https://github.com/zed-industries/zed"
            target="_blank"
            rel="noreferrer"
          >
            Zed
          </Link>
          , licensed GPL-3.0-or-later. KnightCode is not affiliated with or
          endorsed by Zed Industries, Inc. The editor reference — keybindings,
          settings, language support — is theirs and is linked from the Help
          menu. Extensions come from the Zed extension registry, which is the
          only third-party service an install contacts, and only once you open
          the Extensions page.
        </p>

        <p>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`https://github.com/${IDE_REPOSITORY}`}
              target="_blank"
              rel="noreferrer"
            >
              <HugeiconsIcon icon={GithubIcon} className="size-4" />
              Source
            </Link>
          </Button>
        </p>
      </Prose>
    </PageShell>
  )
}
