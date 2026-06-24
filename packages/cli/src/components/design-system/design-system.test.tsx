import { describe, expect, test } from "bun:test";
import { createInkTestRenderer } from '../../tui/testing'
import React from "react";
import ThemedBox from "./ThemedBox";
import ThemedText from "./ThemedText";
import { ThemeProvider } from "./ThemeProvider";

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

describe("design system", () => {
  test("ThemedBox/ThemedText resolve theme-key colors and render", async () => {
    const h = createInkTestRenderer({ width: 40, height: 6 });
    h.render(
        <ThemeProvider initialState="dark">
          <ThemedBox borderStyle="round" borderColor="knightcode" paddingX={1}>
            <ThemedText color="success">hi</ThemedText>
          </ThemedBox>
        </ThemeProvider>
      ,
    );

    const frame = await waitForFrame(h, (f) => f.includes("hi"));
    expect(frame).toContain("╭");

    h.unmount();
  });
});
