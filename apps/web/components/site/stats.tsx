"use client"

import { motion, useReducedMotion, type Variants } from "motion/react"

import { Section } from "./section"

const stats = [
  { value: "npm", label: "Install path" },
  { value: "BYOK", label: "Model access" },
  { value: "Alpha", label: "Product stage" },
  { value: "Apache-2.0", label: "Open source" },
]

const EASE_OUT = [0.23, 1, 0.32, 1] as const

const grid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

const cell: Variants = {
  // Entering the viewport: ease-out, and a transform string so the reveal stays
  // off the main thread while the page is still loading images below.
  hidden: { opacity: 0, transform: "translateY(12px)" },
  show: {
    opacity: 1,
    transform: "translateY(0px)",
    transition: { duration: 0.45, ease: EASE_OUT },
  },
}

export function Stats() {
  const reduceMotion = useReducedMotion()

  return (
    <Section className="!py-12 sm:!py-16">
      <motion.div
        variants={grid}
        initial={reduceMotion ? false : "hidden"}
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 md:grid-cols-4"
      >
        {stats.map((s) => (
          <motion.div
            key={s.label}
            variants={cell}
            className="bg-background px-6 py-8 text-center"
          >
            <div className="font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {s.value}
            </div>
            <div className="mt-1.5 text-xs tracking-wide text-muted-foreground uppercase">
              {s.label}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </Section>
  )
}
