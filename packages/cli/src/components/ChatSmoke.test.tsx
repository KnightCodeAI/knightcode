import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import React from "react";
import { ChatSmoke } from "./ChatSmoke";
import { ThemeProvider } from "../tui";
import TuiApp from "../tui/components/App";

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

type Harness = Awaited<ReturnType<typeof createTestRenderer>>;

async function waitForFrame(
  h: Harness,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    await h.renderOnce();
    frame = h.captureCharFrame();
    if (predicate(frame)) return frame;
    await tick();
  }
  throw new Error(`frame never satisfied predicate; last frame:
${frame}`);
}

describe("chat smoke screen", () => {
  test("renders the prompt input and accepts typed text", async () => {
    const h = await createTestRenderer({ width: 60, height: 12 });
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <ThemeProvider>
          <ChatSmoke />
        </ThemeProvider>
      </TuiApp>,
    );
    const frame = await waitForFrame(h, (f) => f.includes("Type a message"));
    expect(frame).toContain("Type a message");

    // A real terminal re-renders between keystrokes, so each handler closure
    // sees the prior query. typeText fires the whole string in one synchronous
    // batch (no render between), which would stale-close the input — so type
    // one character at a time and render between, mirroring the terminal.
    for (const char of "hi there") {
      h.mockInput.typeText(char);
      await h.renderOnce();
      await tick();
    }
    const typed = await waitForFrame(h, (f) => f.includes("hi there"));
    expect(typed).toContain("hi there");
  });
});
