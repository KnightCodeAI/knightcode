import { GithubIcon, Tag01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell } from "@/components/site/page-shell"
import { Button } from "@/components/ui/button"
import {
  getChangelog,
  isUnreleased,
  type ChangeKind,
  type Product,
} from "@/lib/changelog"
import { fetchDesktopReleases } from "@/lib/desktop-release"
import { getNpmLatestVersion } from "@/lib/version"
import { SITE, FALLBACK_VERSION } from "@/lib/site"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Changelog",
  description: `Release notes for ${SITE.name}.`,
  alternates: { canonical: `${SITE.url}/changelog` },
}

const kindStyles: Record<ChangeKind, string> = {
  Added:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Changed:
    "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Deprecated:
    "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Removed:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  Fixed:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Security:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
}

const PRODUCTS: { id: Product; label: string; href: string }[] = [
  { id: "cli", label: "CLI", href: "/changelog" },
  { id: "desktop", label: "Desktop", href: "/changelog?product=desktop" },
]

function InlineMarkdown({ text }: { text: string }) {
  const parts = []
  let currentIndex = 0

  // Simple regex-based inline markdown parser for code, bold, and links
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index
    const matchText = match[0]

    if (matchIndex > currentIndex) {
      parts.push(text.slice(currentIndex, matchIndex))
    }

    if (matchText.startsWith("`")) {
      const code = matchText.slice(1, -1)
      parts.push(
        <code key={matchIndex} className="rounded bg-muted/90 px-1.5 py-0.5 font-mono text-[13px] text-foreground font-semibold">
          {code}
        </code>
      )
    } else if (matchText.startsWith("**")) {
      const boldText = matchText.slice(2, -2)
      parts.push(<strong key={matchIndex} className="font-semibold text-foreground">{boldText}</strong>)
    } else if (matchText.startsWith("[")) {
      const linkMatch = matchText.match(/\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        const linkText = linkMatch[1]
        const linkHref = linkMatch[2]
        parts.push(
          <a
            key={matchIndex}
            href={linkHref}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-400/40 underline-offset-4 hover:decoration-emerald-300 transition-colors"
          >
            {linkText}
          </a>
        )
      } else {
        parts.push(matchText)
      }
    }

    currentIndex = regex.lastIndex
  }

  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex))
  }

  return <>{parts.length > 0 ? parts : text}</>
}

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const product: Product =
    (await searchParams).product === "desktop" ? "desktop" : "cli"
  const [changelog, releases] = await Promise.all([
    getChangelog(product),
    fetchDesktopReleases(),
  ])
  const unreleased = (version: string) =>
    isUnreleased(version, product, releases)
  // Latest is the newest section that is out, not one merged ahead of its
  // release. Without the releases there is no telling which that is.
  const latest = releases
    ? changelog.find((entry) => !unreleased(entry.version))
    : undefined
  const latestLabel = latest
    ? `Latest - v${latest.version}`
    : product === "cli"
      ? `Latest - v${(await getNpmLatestVersion()) ?? FALLBACK_VERSION}`
      : releases
        ? "No release yet"
        : "Desktop app"

  return (
    <PageShell>
      <PageHero
        eyebrow="Changelog"
        title="Changelog"
        lead="Release notes pulled live from the project changelog - the notable changes per version, shorter than the raw commit history."
        meta={
          <>
            <span>{latestLabel}</span>
            <span className="size-1 rounded-full bg-muted-foreground/40" />
            <span>MIT</span>
          </>
        }
      />

      <div className="mx-auto mb-10 flex max-w-3xl flex-wrap items-center justify-center gap-3 px-4 sm:px-6">
        <nav
          aria-label="Product"
          className="inline-flex rounded-full border border-border/60 bg-card/40 p-0.5 backdrop-blur-sm"
        >
          {PRODUCTS.map((p) => (
            <Link
              key={p.id}
              href={p.href}
              scroll={false}
              aria-current={p.id === product ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded-full px-3.5 text-sm font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]",
                p.id === product
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href={SITE.githubReleases} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
            GitHub releases
          </Link>
        </Button>
      </div>

      <section className="relative pb-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {changelog.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No releases found in the changelog.
            </div>
          ) : (
            <ol className="relative space-y-10 border-l border-border/60 pl-8 sm:pl-10">
              {changelog.map((entry) => {
                const isLatest = entry === latest
                const isUnreleased = unreleased(entry.version)
                return (
                  <li key={entry.version} className="relative">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -left-[37px] flex size-5 items-center justify-center rounded-full border bg-background sm:-left-[45px]",
                        isLatest
                          ? "border-foreground/70 shadow-[0_0_0_4px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
                          : isUnreleased
                            ? "border-dashed border-muted-foreground/60"
                            : "border-border"
                      )}
                    >
                      <HugeiconsIcon
                        icon={Tag01Icon}
                        className="size-2.5"
                        strokeWidth={2.4}
                      />
                    </span>

                    <div className="rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur-sm sm:p-7">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="font-mono text-xl font-semibold tracking-tight">
                          v{entry.version}
                        </h2>
                        {entry.date ? (
                          <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                            {entry.date}
                          </span>
                        ) : null}
                        {isLatest ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-emerald-700 dark:text-emerald-300 uppercase">
                            Latest
                          </span>
                        ) : null}
                        {isUnreleased ? (
                          <span
                            title="In the changelog on main, with no published GitHub release yet"
                            className="rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
                          >
                            Unreleased
                          </span>
                        ) : null}
                      </div>

                      {entry.highlight ? (
                        <p className="mt-2 text-base text-foreground/85 sm:text-lg">
                          <InlineMarkdown text={entry.highlight} />
                        </p>
                      ) : null}

                      <div className="mt-5 space-y-5">
                        {entry.groups.map((g) => (
                          <div key={g.kind}>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase",
                                  kindStyles[g.kind]
                                )}
                              >
                                {g.kind}
                              </span>
                            </div>
                            <ul className="mt-3 space-y-2 pl-1">
                              {g.items.map((item, i) => (
                                <li
                                  key={i}
                                  className="relative pl-5 text-sm leading-relaxed text-foreground/75 before:absolute before:top-2.5 before:left-0 before:size-1 before:rounded-full before:bg-muted-foreground/50"
                                >
                                  <InlineMarkdown text={item} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </section>
    </PageShell>
  )
}
