"use client"

import { Download01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  guessPlatform,
  type Platform,
  type ReleaseFiles,
} from "@/lib/ide-release"
import { cn } from "@/lib/utils"

type Download = { platform: Platform; files: ReleaseFiles }
type PlatformKey = Platform["key"]

// Not in lib.dom yet: the Client Hints API only Chromium ships.
type HintedNavigator = Navigator & {
  userAgentData?: {
    mobile: boolean
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
  }
}

const press =
  "transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97]"

// The server already guessed from the User-Agent header, so the right builds
// are in the first paint. The browser can only add the CPU, and only Chromium
// tells it, so this narrows the guess at most once: a Mac to its one build, or
// Linux to ARM.
function usePlatformGuess(initial: PlatformKey[]) {
  const [guess, setGuess] = React.useState(initial)
  React.useEffect(() => {
    const nav = navigator as HintedNavigator
    // iPadOS Safari sends a Mac user agent; a Mac has no touch screen.
    const mobile =
      nav.userAgentData?.mobile ||
      (/macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1)
    let live = true
    Promise.resolve(nav.userAgentData?.getHighEntropyValues(["architecture"]))
      .then((hints) => hints?.architecture)
      .catch(() => undefined)
      .then((architecture) => {
        if (live)
          setGuess(
            guessPlatform({ userAgent: nav.userAgent, architecture, mobile })
          )
      })
    return () => {
      live = false
    }
  }, [])
  return guess
}

export function IdeDownloads({
  downloads,
  initialGuess,
}: {
  downloads: Download[]
  initialGuess: PlatformKey[]
}) {
  const guess = usePlatformGuess(initialGuess)
  const featured = downloads.filter((d) => guess.includes(d.platform.key))
  const rest = downloads.filter((d) => !featured.includes(d))
  // Only a Mac whose chip the browser would not name gets two.
  const choosing = featured.length > 1

  return (
    <div className="flex flex-col gap-12">
      {featured.length > 0 ? (
        <div
          // Remount on a swap so the corrected build fades in rather than
          // its label changing under the reader.
          key={guess.join()}
          className={cn(
            "flex flex-col items-center gap-4 text-center",
            guess.join() !== initialGuess.join() &&
              "animate-in duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in-0"
          )}
        >
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-4">
            {featured.map(({ platform, files }) => (
              <div
                key={platform.key}
                className="flex flex-col items-center gap-3"
              >
                <Button asChild size="lg" className={cn("h-11 px-6", press)}>
                  <a href={files.url}>
                    <HugeiconsIcon
                      icon={Download01Icon}
                      className="size-4"
                      strokeWidth={2}
                    />
                    Download for {choosing ? platform.arch : platform.os}
                  </a>
                </Button>
                <p className="text-sm text-muted-foreground">
                  v{files.version} for{" "}
                  {choosing ? `${platform.os} ${platform.arch}` : platform.arch}{" "}
                  ·{" "}
                  <a
                    href={files.signatureUrl}
                    className="underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                  >
                    Signature
                  </a>
                </p>
              </div>
            ))}
          </div>
          {choosing ? (
            <p className="max-w-md text-sm text-muted-foreground">
              Not sure which? Apple menu → About This Mac lists a Chip for Apple
              silicon, or a Processor for Intel.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-medium text-muted-foreground">
          {featured.length > 0 ? "Other platforms" : "All platforms"}
        </h2>
        <ul className="mt-3 divide-y divide-border/50 border-y border-border/50">
          {rest.map(({ platform, files }) => (
            <li key={platform.key} className="flex items-center gap-4 py-3">
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{platform.os}</span>
                <span className="ml-2 text-muted-foreground">
                  {platform.arch}
                </span>
              </p>
              <a
                href={files.signatureUrl}
                className="hidden text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                Signature
              </a>
              <Button asChild size="sm" variant="ghost" className={press}>
                <a href={files.url} aria-label={`Download ${platform.file}`}>
                  <HugeiconsIcon
                    icon={Download01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
