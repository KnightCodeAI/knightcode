import { describe, expect, test } from "bun:test";
import { createInkTestRenderer } from './tui/testing'
import React from "react";
import { Box, Text, ThemeProvider } from "./tui";

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

type Harness = ReturnType<typeof createInkTestRenderer>;

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
    const h = createInkTestRenderer({ width: 50, height: 8 });
    h.render(
        <ThemeProvider>
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>knightcode</Text>
            <Text dimColor>renderer up</Text>
          </Box>
        </ThemeProvider>
      ,
    );

    const frame = await waitForFrame(h, (f) => f.includes("knightcode"));
    expect(frame).toContain("renderer up");
    expect(frame).toContain("╭");

    h.unmount();
  });
});
