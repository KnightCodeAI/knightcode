import { GithubIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import Image from "next/image"
import Link from "next/link"

import { SITE, PRODUCT_LINKS } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"

const legalLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Security", href: "/security" },
]

const communityLinks = [
  { label: "GitHub", href: SITE.github, external: true },
  { label: "Issues", href: SITE.issues, external: true },
  { label: "Releases", href: SITE.githubReleases, external: true },
]

function NpmLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 7"
      className={className}
      fill="currentColor"
      width="18"
      height="7"
    >
      <path
        fillRule="evenodd"
        d="M0 0h18v6H9v1H5V6H0V0z M1 5h2V2h1v3h1V1H1V5z M6 1v5h2V5h2V1H6z M8 2h1v2H8V2z M11 1v4h2V2h1v3h1V2h1v3h1V1H11z"
      />
    </svg>
  )
}

export async function SiteFooter() {
  const version = await getLatestVersion()
  return (
    <footer className="relative border-t border-border/50 bg-muted/20">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image
              src="/knightcode_icon_256.png"
              alt=""
              width={28}
              height={28}
              className="rounded-md"
            />
            <span className="text-base font-semibold tracking-tight">
              {SITE.name}
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            {SITE.tagline}
          </p>
          <p className="mt-6 font-mono text-xs text-muted-foreground/70">
            v{version} - Alpha
          </p>
        </div>

        <FooterCol title="Product" links={PRODUCT_LINKS as never} />
        <FooterCol title="Legal" links={legalLinks} />
        <FooterCol title="Community" links={communityLinks} />
      </div>

      <div className="border-t border-border/50">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>
            © {new Date().getFullYear()} {SITE.name}. Open source, BYOK, and
            built around local developer workflows.
          </span>
          <div className="flex items-center gap-4">
            <Link
              href={SITE.github}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <HugeiconsIcon
                icon={GithubIcon}
                className="size-3.5"
                strokeWidth={2}
              />
              KnightCodeAI/knightcode
            </Link>
            <Link
              href={SITE.npm}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <NpmLogo className="h-2.5 w-auto fill-current opacity-70 transition-opacity hover:opacity-100" />
              @knightcodeai/cli
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: { label: string; href: string; external?: boolean }[]
}) {
  return (
    <div>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
