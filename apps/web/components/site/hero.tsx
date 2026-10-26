"use client"

import { ArrowRight01Icon, CommandLineIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion, useReducedMotion, type Variants } from "motion/react"
import dynamic from "next/dynamic"
import Link from "next/link"

import { TypingAnimation } from "@/components/text-typing"
import type { DesktopDownloads } from "@/lib/desktop-release"
import { useMediaQuery } from "@/lib/use-media-query"
import { NPM_PACKAGE, SITE, FALLBACK_VERSION } from "@/lib/site"
import { DesktopDownload } from "./desktop-download"
import { InstallCommand, TabBarLabel } from "./install-command"

// Phones never see the terminal, so they should never pay for it either: the
// panel is ~80 columns of monospace that cannot shrink, and its script runs
// timers for as long as the page is open.
const LiveTerminal = dynamic(
  () => import("./live-terminal").then((m) => m.LiveTerminal),
  { ssr: false }
)

const PHRASES = [
  "inside your terminal.",
  "on your desktop.",
  "with your own key.",
  "close to your repo.",
  "on your machine.",
]

const EASE_OUT = [0.23, 1, 0.32, 1] as const

const stack: Variants = {
  hidden: {},
  show: { transition: { delayChildren: 0.05, staggerChildren: 0.07 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
}

export function Hero({
  version = FALLBACK_VERSION,
  desktop,
}: {
  version?: string
  desktop: DesktopDownloads | null
}) {
  const reduceMotion = useReducedMotion()
  // Matches the lg breakpoint below, where the layout gains a second column.
  const twoColumn = useMediaQuery("(min-width: 64rem)")

  // The hero owns the first viewport, so nothing below it peeks in before the
  // user scrolls.
  return (
    <section className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden pt-28 pb-20 sm:pt-32 sm:pb-28">
      {/* Two columns from lg: the pitch on the left, a running session on the
          right, so the first screen shows what the thing actually looks like. */}
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
        {/* Left-aligned: the second headline line is a typewriter, and centering
            it would re-center the line on every keystroke. One shared left axis
            keeps every element still. */}
        <motion.div
          variants={stack}
          initial={reduceMotion ? false : "hidden"}
          animate="show"
          className="flex min-w-0 max-w-2xl flex-col items-start"
        >
          <motion.div variants={item}>
            <Link
              href={`${SITE.githubReleases}/tag/${encodeURIComponent(`${NPM_PACKAGE}@${version}`)}`}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase backdrop-blur-md transition-[color,border-color,transform] duration-200 ease-out hover:border-foreground/25 hover:text-foreground active:scale-[0.98]"
            >
              <span className="size-1.5 rounded-full bg-(--brand)" />
              <span>v{version}</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="size-3 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </Link>
          </motion.div>

          <motion.h1
            variants={item}
            className="mt-8 text-[clamp(1.75rem,9.2vw,2.5rem)] leading-[1.08] font-semibold tracking-[-0.04em] sm:text-5xl md:text-6xl lg:text-[2.6rem] xl:text-5xl"
          >
            {/* The visible headline cycles; the accessible name must not. */}
            <span className="sr-only">Agentic coding, on your machine.</span>
            <span aria-hidden>
              <span className="block text-foreground/55">Agentic coding,</span>
              {/* One line, always. The phrases differ in length, so without
                  nowrap the longer ones wrapped to a second line and the
                  paragraph, install box and platform row jumped on every
                  cycle. The scale above is measured against the narrowest box
                  each breakpoint gives this column, cursor included: the
                  widest phrase runs 9.2x the font size, and lg is the tight
                  one because the layout splits into two columns there (414px
                  at a 1024px laptop). Re-measure before making it bigger or
                  adding a longer phrase. */}
              <span className="block whitespace-nowrap">
                {reduceMotion ? (
                  "on your machine."
                ) : (
                  <TypingAnimation
                    words={PHRASES}
                    loop
                    typeSpeed={70}
                    deleteSpeed={40}
                    pauseDelay={1700}
                    startOnView={false}
                    cursorStyle="line"
                  />
                )}
              </span>
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-6 max-w-xl text-base text-foreground/70 sm:text-lg"
          >
            A local coding agent, in your terminal or as a desktop app. It
            reads, searches, edits, and runs commands in the folder you opened,
            through the provider account you choose.
          </motion.p>

          {/* Both ways in, one card: each row names itself on the left and
              offers its choices on the right, so the two read as siblings. */}
          <motion.div
            variants={item}
            className="mt-9 w-full divide-y divide-border overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm backdrop-blur-md"
          >
            <InstallCommand
              label={<TabBarLabel icon={CommandLineIcon}>Terminal</TabBarLabel>}
              className="rounded-none border-x-0 border-t-0 bg-transparent shadow-none backdrop-blur-none"
            />
            <DesktopDownload downloads={desktop} />
          </motion.div>

          <motion.a
            variants={item}
            href={`${SITE.productHunt}?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-knightcode`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 transition-transform duration-200 ease-out active:scale-[0.98]"
          >
            {/* Plain img: next/image refuses remote SVGs without
                dangerouslyAllowSVG. Lazy loading keeps the hidden theme's
                badge from being fetched at all. */}
            {(["light", "dark"] as const).map((theme) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={theme}
                src={`https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=${SITE.productHuntPostId}&theme=${theme}`}
                alt={`${SITE.name} on Product Hunt`}
                width={250}
                height={54}
                loading="lazy"
                className={theme === "light" ? "dark:hidden" : "hidden dark:block"}
              />
            ))}
          </motion.a>
        </motion.div>

        {twoColumn && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.18 }}
            className="w-full"
          >
            <LiveTerminal version={version} className="h-[34rem]" />
          </motion.div>
        )}
      </div>
    </section>
  )
}
