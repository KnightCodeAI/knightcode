"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { NPM_PACKAGE } from "@/lib/site"
import { cn } from "@/lib/utils"

// The CLI ships platform binaries as optionalDependencies, so every major
// package manager installs it the same way.
const MANAGERS = [
  { id: "npm", command: `npm install -g ${NPM_PACKAGE}` },
  { id: "pnpm", command: `pnpm add -g ${NPM_PACKAGE}` },
  { id: "bun", command: `bun install -g ${NPM_PACKAGE}` },
  { id: "yarn", command: `yarn global add ${NPM_PACKAGE}` },
  { id: "npx", command: `npx ${NPM_PACKAGE}` },
] as const

type ManagerId = (typeof MANAGERS)[number]["id"]

/** A single copyable command line. */
export function CommandBlock({
  command,
  className,
}: {
  command: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy", err)
    }
  }

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)}>
      <span
        aria-hidden
        className="font-mono text-xs select-none text-(--brand) sm:text-sm"
      >
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-foreground/90 select-all sm:text-sm">
        {command}
      </code>
      <button
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy: ${command}`}
        className={cn(
          "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-[color,background-color,border-color,transform] duration-200 ease-out active:scale-95",
          copied
            ? "border-(--brand) bg-(--brand) text-white"
            : "border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground"
        )}
      >
        <HugeiconsIcon
          icon={copied ? Tick01Icon : Copy01Icon}
          className={cn("size-4 transition-transform duration-200", copied && "scale-110")}
          strokeWidth={2}
        />
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  )
}

/** Install command with a package-manager switcher. */
export function InstallCommand({ className }: { className?: string }) {
  const [manager, setManager] = useState<ManagerId>("npm")
  const barRef = useRef<HTMLDivElement>(null)
  // Motion's shared-element `layoutId` mis-measured this underline: it
  // rendered ~28px below the tab row on every switch and slid diagonally back
  // up. The tabs never move relative to the bar, so the indicator is placed
  // from the active tab's own offsets and moved with a plain CSS transition.
  const [rail, setRail] = useState({ left: 0, width: 0 })
  const active = MANAGERS.find((m) => m.id === manager) ?? MANAGERS[0]

  useLayoutEffect(() => {
    const tab = barRef.current?.querySelector<HTMLElement>("[data-active]")
    if (!tab) return
    const measure = () => setRail({ left: tab.offsetLeft, width: tab.offsetWidth })
    measure()
    // The tabs are content-sized, so only a font swap moves them.
    const observer = new ResizeObserver(measure)
    observer.observe(tab)
    return () => observer.disconnect()
  }, [manager])

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm backdrop-blur-md",
        className
      )}
    >
      <div
        ref={barRef}
        className="relative flex items-center border-b border-border/50 px-2"
      >
        {MANAGERS.map((m) => {
          const isActive = m.id === manager
          return (
            <button
              key={m.id}
              onClick={() => setManager(m.id)}
              aria-pressed={isActive}
              data-active={isActive ? "" : undefined}
              className={cn(
                "cursor-pointer px-3 py-2.5 font-mono text-xs transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {m.id}
            </button>
          )
        })}
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-px bg-(--brand) transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          style={{
            transform: `translateX(${rail.left + 8}px)`,
            width: Math.max(0, rail.width - 16),
          }}
        />
      </div>
      {/* key: reset the copied state when the command changes */}
      <CommandBlock key={manager} command={active.command} />
    </div>
  )
}
