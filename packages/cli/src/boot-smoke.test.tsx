import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import React from "react";
import { Box, Text, ThemeProvider } from "./tui";
import TuiApp from "./tui/components/App";

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

describe("boot smoke", () => {
  test("a frame renders through the public barrel", async () => {
    const h = await createTestRenderer({ width: 50, height: 8 });
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <ThemeProvider>
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>knightcode</Text>
            <Text dimColor>renderer up</Text>
          </Box>
        </ThemeProvider>
      </TuiApp>,
    );

    const frame = await waitForFrame(h, (f) => f.includes("knightcode"));
    expect(frame).toContain("renderer up");
    expect(frame).toContain("╭");

    h.renderer.destroy();
  });
});
