import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { TerminalCodeLine } from "./live-terminal-code-line"

describe("terminal code rows", () => {
  it("places the line number before the diff marker with a full-width tint", () => {
    const added = renderToStaticMarkup(
      <TerminalCodeLine lineNumber={1459} digits={4} kind="added">
        await sleep(Math.min(delay, MAX_WAIT));
      </TerminalCodeLine>
    )
    expect(added).toContain("1459 +</span>")
    expect(added).toContain("background:#1f3124")
    expect(added).toContain("w-full")

    const removed = renderToStaticMarkup(
      <TerminalCodeLine lineNumber={1459} digits={4} kind="removed">
        await sleep(delay);
      </TerminalCodeLine>
    )
    expect(removed).toContain("1459 -</span>")
    expect(removed).toContain("background:#3c211b")
  })

  it("keeps the number and marker out of wrapped syntax-highlighted code", () => {
    const html = renderToStaticMarkup(
      <TerminalCodeLine lineNumber={9} digits={2} kind="added">
        <span style={{ color: "#ff8a3d" }}>await</span> sleep(delay);
      </TerminalCodeLine>
    )
    expect(html).toContain("shrink-0 whitespace-pre")
    expect(html).toContain(" 9 +</span>")
    expect(html).toContain("min-w-0 flex-1 break-words whitespace-pre-wrap")
    expect(html).toContain('<span style="color:#ff8a3d">await</span>')
  })

  it("aligns numbered file and context rows without a diff marker or tint", () => {
    const html = renderToStaticMarkup(
      <TerminalCodeLine lineNumber={1} digits={2}>
        {"import { describe } from 'vitest';"}
      </TerminalCodeLine>
    )
    expect(html).toContain(" 1  </span>")
    expect(html).not.toContain("background:")
  })

  it("shows omitted lines as a dim vertical ellipsis aligned with the marker", () => {
    const html = renderToStaticMarkup(
      <TerminalCodeLine digits={4} kind="skip" />
    )
    expect(html).toContain("     ⋮</span>")
    expect(html).not.toContain("...")
    expect(html).not.toContain("background:")
  })
})
