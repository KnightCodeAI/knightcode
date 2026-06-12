import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import React from "react";
import App from "./components/App";
import Box from "./components/Box";
import Text from "./components/Text";
import type { Key } from "./events/input-event";
import useInput from "./hooks/use-input";

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

type Harness = Awaited<ReturnType<typeof createTestRenderer>>;

/** Re-renders until the frame satisfies the predicate (timing-robust under load). */
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

function mount(h: Harness, node: React.ReactNode) {
  createRoot(h.renderer).render(
    <App renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
      {node}
    </App>,
  );
}

describe("tui bridge over opentui", () => {
  test("Box lays out children in a row with a border", async () => {
    const h = await createTestRenderer({ width: 40, height: 8 });
    mount(
      h,
      <Box flexDirection="row" borderStyle="round" gap={1}>
        <Text>left</Text>
        <Text>right</Text>
      </Box>,
    );

    const frame = await waitForFrame(h, (f) => f.includes("left"));
    expect(frame).toContain("right");
    expect(frame).toContain("╭");
    // Row layout: both words on the same line.
    const line = frame.split("\n").find((l) => l.includes("left"));
    expect(line).toContain("right");

    h.renderer.destroy();
  });

  test("Text styles render without throwing and content survives", async () => {
    const h = await createTestRenderer({ width: 40, height: 6 });
    mount(
      h,
      <Box flexDirection="column">
        <Text bold color="ansi:green">
          ok
        </Text>
        <Text dim>
          dim <Text underline>nested</Text>
        </Text>
      </Box>,
    );

    const frame = await waitForFrame(h, (f) => f.includes("ok"));
    expect(frame).toContain("dim");
    expect(frame).toContain("nested");

    h.renderer.destroy();
  });

  test("useInput receives a mapped Key object for an arrow key", async () => {
    const h = await createTestRenderer({ width: 40, height: 4 });
    let recorded: { input: string; key: Key } | null = null;

    function Probe() {
      useInput((input, key) => {
        recorded = { input, key };
      });
      return <Text>probe</Text>;
    }
    mount(h, <Probe />);
    await waitForFrame(h, (f) => f.includes("probe"));

    // The keyboard subscription mounts in a passive effect; retry until
    // the handler records the press.
    for (let attempt = 0; attempt < 20 && !recorded; attempt++) {
      h.mockInput.pressKey("ARROW_DOWN");
      await h.renderOnce();
      await tick();
    }

    expect(recorded).not.toBeNull();
    expect(recorded!.key.downArrow).toBe(true);
    expect(recorded!.input).toBe("");

    h.renderer.destroy();
  });
});
