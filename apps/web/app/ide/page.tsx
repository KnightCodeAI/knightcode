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
    "Unsigned installers for the KnightCode desktop IDE. A clean-machine install has not been run.",
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
        lead="A desktop editor on a fork of Zed. KnightCode is its agent and its inference path. The v1 installers are unsigned, and a clean-machine install has not been run."
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
                Windows SmartScreen and macOS Gatekeeper warn on an unsigned
                build. That is what a missing certificate looks like. A
                clean-machine install — a machine with no Node, Bun, npm, or
                CLI — has not been run, and the macOS and Linux bundle scripts
                have not been run. The steps below are what an unsigned build
                is expected to do.
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

        <h2>Intended first run</h2>
        <p>
          The design walks you through a theme, a keymap, a provider sign-in,
          a model, and a folder. There is no KnightCode account. The IDE and
          the CLI are designed to read the same <code>auth.json</code>, so a
          machine already signed in to the CLI skips that step. This path is
          the packaging exit condition, and it has not been run on a clean
          machine.
        </p>

        <h2>Updates</h2>
        <p>
          The updater is designed to check hourly and to install a download
          only when the release key signed its digest. The installers
          themselves are unsigned. Turn the check off with{" "}
          <code>&quot;auto_update&quot;: false</code> in settings.
        </p>

        <h2>What it may send</h2>
        <p>
          If you allow it on first run, the IDE may send a fixed set of install
          and launch events: version, channel, operating system, architecture,
          an approximate location (country, region, city) added by the site,
          whether setup finished, whether the engine became ready, and which
          surface you used first. Those events do not include file names,
          prompts, account details, model ids, or a machine id.{" "}
          <code>enableInstallTelemetry</code> turns the set off. Prompts you
          send still go to the provider you signed in to. Details are in the{" "}
          <Link href="/docs/ide">IDE docs</Link>.
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
          endorsed by Zed Industries, Inc. Keybindings, settings, and language
          support follow the editor. Extensions come from the Zed extension
          registry when you open the Extensions page.
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
