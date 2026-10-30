"use client"

import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { NPM_PACKAGE, SITE } from "@/lib/site"
import { cn } from "@/lib/utils"
import { usePlatform } from "./platform-detect"

// The installers pin every dependency and update with `knightcode update`;
// the CLI is a Node bundle with no install scripts, so package managers work
// too.
const MANAGERS = [
  {
    id: "curl",
    label: "curl",
    command: `curl -fsSL ${SITE.url}/install.sh | sh`,
  },
  {
    id: "powershell",
    label: "PowerShell",
    command: `powershell -c "irm ${SITE.url}/install.ps1 | iex"`,
  },
  {
    id: "npm",
    label: "npm",
    command: `npm install -g --ignore-scripts ${NPM_PACKAGE}`,
  },
  {
    id: "pnpm",
    label: "pnpm",
    command: `pnpm add -g --ignore-scripts ${NPM_PACKAGE}`,
  },
  {
    id: "bun",
    label: "bun",
    command: `bun add -g --ignore-scripts ${NPM_PACKAGE}`,
  },
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
      {/* One line, sized to fit: the longest command is 62ch including the
          prompt, and a Geist Mono ch is 0.6em, so 100cqi / 37.2 fills the row.
          Below the 11px floor (narrow phones) it scrolls by swipe instead. */}
      <p className="@container min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="font-mono text-[length:clamp(11px,2.6cqi,14px)] whitespace-nowrap">
          <span aria-hidden className="select-none text-(--brand)">
            $
          </span>{" "}
          <code className="text-foreground/90 select-all">{command}</code>
        </span>
      </p>
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

/** Toggle tabs with a sliding underline, after an optional row label. */
export function TabBar<T extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: readonly { id: T; label: string }[]
  active: T
  onSelect: (id: T) => void
  label?: ReactNode
}) {
  const barRef = useRef<HTMLDivElement>(null)
  // Motion's shared-element `layoutId` mis-measured this underline: it
  // rendered ~28px below the tab row on every switch and slid diagonally back
  // up. The tabs never move relative to the bar, so the indicator is placed
  // from the active tab's own offsets and moved with a plain CSS transition.
  const [rail, setRail] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const bar = barRef.current
    const tab = bar?.querySelector<HTMLElement>("[data-active]")
    if (!bar || !tab) return
    const measure = () => setRail({ left: tab.offsetLeft, width: tab.offsetWidth })
    measure()
    // A font swap resizes the tab, and with a label the tabs sit at the bar's
    // end, so resizing the bar moves them too.
    const observer = new ResizeObserver(measure)
    observer.observe(tab)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [active])

  return (
    // On the narrowest phones the tabs outgrow the card, so the row scrolls
    // by swipe; the underline lives inside it and scrolls along.
    <div
      ref={barRef}
      className="relative flex items-center overflow-x-auto border-b border-border/50 bg-foreground/[0.025] px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {label}
      {/* With a label the tabs sit at the row's end, as its options. */}
      <div className={cn("flex", label && "ml-auto")}>
        {tabs.map((t) => {
          const isActive = t.id === active
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-pressed={isActive}
              data-active={isActive ? "" : undefined}
              className={cn(
                "cursor-pointer px-2.5 py-2.5 font-mono text-xs transition-colors sm:px-3",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-px bg-(--brand) transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
        style={{
          transform: `translateX(${rail.left + 8}px)`,
          width: Math.max(0, rail.width - 16),
        }}
      />
    </div>
  )
}

/** A row label for a TabBar: an icon and a short name. */
export function TabBarLabel({
  icon,
  children,
}: {
  icon: IconSvgElement
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-2 py-2.5 pr-3 pl-2 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
      <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={2} />
      {/* Icon only on phones, where the name would push the last tab out. */}
      <span className="max-sm:sr-only">{children}</span>
    </span>
  )
}

/** Install command with an installer and package-manager switcher. */
export function InstallCommand({
  className,
  label,
}: {
  className?: string
  label?: ReactNode
}) {
  const detected = usePlatform()
  const [picked, setPicked] = useState<ManagerId | null>(null)
  // The visitor's installer first: PowerShell on Windows, curl elsewhere.
  const manager = picked ?? (detected === "windows" ? "powershell" : "curl")
  const active = MANAGERS.find((m) => m.id === manager) ?? MANAGERS[0]

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm backdrop-blur-md",
        className
      )}
    >
      <TabBar
        tabs={MANAGERS}
        active={manager}
        onSelect={setPicked}
        label={label}
      />
      {/* key: reset the copied state when the command changes */}
      <CommandBlock key={manager} command={active.command} />
    </div>
  )
}
