import type { ReactNode } from "react"

export type TerminalCodeLineProps = {
  lineNumber?: number
  digits: number
  kind?: "context" | "added" | "removed" | "skip"
  children?: ReactNode
}

/** components/diff.ts: a fixed number/sign gutter, code wrapping under itself,
 *  and a tint across the available code width (not the tool-result gutter). */
export function TerminalCodeLine({
  lineNumber,
  digits,
  kind = "context",
  children,
}: TerminalCodeLineProps) {
  if (kind === "skip") {
    return (
      <div className="min-h-[1.45em] w-full">
        <span className="whitespace-pre" style={{ color: "#7b756e" }}>
          {`${" ".repeat(digits + 1)}⋮`}
        </span>
      </div>
    )
  }

  const added = kind === "added"
  const removed = kind === "removed"
  const color = added ? "#8fb573" : removed ? "#ea6f59" : "#7b756e"
  const background = added ? "#1f3124" : removed ? "#3c211b" : undefined
  const number = String(lineNumber ?? "").padStart(digits)
  const marker = added ? "+" : removed ? "-" : " "

  return (
    <div
      className="flex min-h-[1.45em] w-full"
      style={{ background, color: removed ? "#ea6f59" : undefined }}
    >
      <span className="shrink-0 whitespace-pre" style={{ color }}>
        {`${number} ${marker}`}
      </span>
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {children}
      </span>
    </div>
  )
}
