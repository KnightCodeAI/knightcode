"use client"

import { useState } from "react"
import {
  ArrowRight01Icon,
  Copy01Icon,
  GithubIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import Link from "next/link"

import { TypingAnimation } from "@/components/text-typing"
import { Button } from "@/components/ui/button"
import { INSTALL_COMMAND, NPM_PACKAGE, SITE, FALLBACK_VERSION } from "@/lib/site"
import { cn } from "@/lib/utils"

export function Hero({ version = FALLBACK_VERSION }: { version?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy", err)
    }
  }

  return (
    <section className="relative isolate overflow-hidden pt-36 pb-24 sm:pt-44 sm:pb-32">
      {/* Hero-only soft accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.06),transparent_70%)]"
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center px-4 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link
            href={`${SITE.githubReleases}/tag/${encodeURIComponent(`${NPM_PACKAGE}@${version}`)}`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase backdrop-blur-md transition-colors hover:text-foreground"
          >
            <span className="size-1.5 rounded-full bg-foreground/70" />
            <span>Alpha v{version}</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-3 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-7 text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-5xl md:text-6xl lg:text-7xl"
        >
          <span className="text-foreground/55">Agentic coding,</span>
          <br className="inline" />{" "}
          <TypingAnimation
            words={["inside your terminal.", "with your model key.", "close to your repo.", "under your control."]}
            loop
            typeSpeed={70}
            deleteSpeed={40}
            pauseDelay={1700}
            className="text-foreground"
            cursorStyle="line"
          />
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12 }}
          className="mt-7 max-w-xl text-base text-balance text-foreground/70 sm:text-lg"
        >
          KnightCode is an early, npm-installed coding app with a React/OpenTUI
          terminal interface, repo-aware agents, approval-based tools, and a
          bring-your-own-key model setup.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18 }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button
            onClick={handleCopy}
            size="lg"
            className="group/hero-btn flex items-center justify-center gap-2.5 rounded-full px-6 cursor-pointer transition-all active:scale-95 min-w-[280px] shadow-sm"
          >
            <span>{INSTALL_COMMAND}</span>
            <HugeiconsIcon
              icon={copied ? Tick01Icon : Copy01Icon}
              className={cn("size-4 transition-all duration-200", copied ? "text-primary-foreground scale-110" : "text-primary-foreground/70 group-hover/hero-btn:text-primary-foreground")}
              strokeWidth={2}
            />
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="rounded-full px-5"
          >
            <Link href={SITE.github} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />
              View on GitHub
            </Link>
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.32 }}
          className="mt-16 flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] text-foreground/60 uppercase"
        >
          <span>macOS</span>
          <span className="size-1 rounded-full bg-muted-foreground/40" />
          <span>Linux</span>
          <span className="size-1 rounded-full bg-muted-foreground/40" />
          <span>Windows</span>
        </motion.div>
      </div>
    </section>
  )
}
