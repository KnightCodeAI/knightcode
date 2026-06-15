import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import React from "react";
import TuiApp from "../../tui/components/App";
import ThemedBox from "./ThemedBox";
import ThemedText from "./ThemedText";
import { ThemeProvider } from "./ThemeProvider";

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
  throw new Error(`frame never satisfied predicate; last frame:\n${frame}`);
}

describe("design system", () => {
  test("ThemedBox/ThemedText resolve theme-key colors and render", async () => {
    const h = await createTestRenderer({ width: 40, height: 6 });
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <ThemeProvider initialState="dark">
          <ThemedBox borderStyle="round" borderColor="knightcode" paddingX={1}>
            <ThemedText color="success">hi</ThemedText>
          </ThemedBox>
        </ThemeProvider>
      </TuiApp>,
    );

    const frame = await waitForFrame(h, (f) => f.includes("hi"));
    expect(frame).toContain("╭");

    h.renderer.destroy();
  });
});
