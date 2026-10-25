"use client"

import {
  ComputerIcon,
  Download04Icon,
  GithubIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import Image from "next/image"
import { type ReactNode, useState } from "react"

import type { DesktopDownloads } from "@/lib/desktop-release"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"
import appIcon from "@/public/knightcode_icon_256.png"
import { TabBar, TabBarLabel } from "./install-command"
import { usePlatform } from "./platform-detect"

const PLATFORMS = [
  { id: "mac", label: "macOS" },
  { id: "windows", label: "Windows" },
  { id: "linux", label: "Linux" },
] as const

type DesktopPlatform = (typeof PLATFORMS)[number]["id"]

type Build = { href: string; label: string; name: string }

// The first build is the Download button; any other is its alternative. A
// missing installer falls back to the release page, which lists them all.
function builds(
  platform: DesktopPlatform,
  d: DesktopDownloads
): { detail: string; files: Build[] } {
  switch (platform) {
    case "mac":
      return {
        detail: "Apple silicon .dmg",
        files: [
          {
            href: d.macArm64 ?? d.page,
            label: "Download",
            name: "macOS, Apple silicon",
          },
          { href: d.macX64 ?? d.page, label: "Intel", name: "macOS, Intel" },
        ],
      }
    case "windows":
      return {
        detail: "Windows x64 installer",
        files: [
          { href: d.windows ?? d.page, label: "Download", name: "Windows" },
        ],
      }
    case "linux":
      return {
        detail: "Linux x64 .deb",
        files: [
          { href: d.deb ?? d.page, label: "Download", name: "Linux, .deb" },
          { href: d.rpm ?? d.page, label: ".rpm", name: "Linux, .rpm" },
        ],
      }
  }
}

const PILL =
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full text-sm font-medium outline-none transition-[color,background-color,border-color,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.97]"

function Body({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    // Wraps below sm: the text keeps 8rem, so the buttons drop to their own line
    // before they squeeze it.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-2.5">
      <Image
        src={appIcon}
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 rounded-[9px] ring-1 ring-foreground/10"
      />
      <div className="min-w-0 flex-[1_1_8rem]">
        <div className="truncate text-sm font-medium text-foreground/90">
          {title}
        </div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * The desktop app's installers, for the visitor's platform first. `null` means
 * no release is published yet.
 */
export function DesktopDownload({
  downloads,
  className,
}: {
  downloads: DesktopDownloads | null
  className?: string
}) {
  const detected = usePlatform()
  const [picked, setPicked] = useState<DesktopPlatform | null>(null)
  const platform = picked ?? (detected === "unknown" ? "mac" : detected)
  const label = <TabBarLabel icon={ComputerIcon}>Desktop</TabBarLabel>

  if (!downloads)
    return (
      <div className={className}>
        <div className="flex items-center border-b border-border/50 bg-foreground/[0.025] px-2">
          {label}
          <span className="ml-auto px-3 py-2.5 font-mono text-xs text-muted-foreground">
            Coming soon
          </span>
        </div>
        <Body title="KnightCode for desktop" detail="macOS, Windows, and Linux">
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer"
            className={cn(
              PILL,
              "border border-border/60 px-3.5 text-foreground/80 hover:border-foreground/25 hover:text-foreground"
            )}
          >
            <HugeiconsIcon
              icon={GithubIcon}
              className="size-4"
              strokeWidth={2}
            />
            Watch releases
          </a>
        </Body>
      </div>
    )

  const { detail, files } = builds(platform, downloads)
  const [main, ...others] = files

  return (
    <div className={className}>
      <TabBar
        tabs={PLATFORMS}
        active={platform}
        onSelect={setPicked}
        label={label}
      />
      <Body
        title={
          downloads.version ? `KnightCode ${downloads.version}` : "KnightCode"
        }
        detail={detail}
      >
        <a
          href={main.href}
          aria-label={`Download KnightCode for ${main.name}`}
          className={cn(
            PILL,
            "group bg-primary pr-4 pl-3.5 text-primary-foreground hover:bg-primary/85"
          )}
        >
          <HugeiconsIcon
            icon={Download04Icon}
            className="size-4 transition-transform duration-200 ease-out group-hover:translate-y-px"
            strokeWidth={2}
          />
          {main.label}
        </a>
        {others.map((build) => (
          <a
            key={build.name}
            href={build.href}
            aria-label={`Download KnightCode for ${build.name}`}
            className={cn(
              PILL,
              "border border-border/60 px-3.5 text-foreground/80 hover:border-foreground/25 hover:text-foreground"
            )}
          >
            {build.label}
          </a>
        ))}
      </Body>
    </div>
  )
}
