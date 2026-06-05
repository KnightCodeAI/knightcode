import { type ModeType, Mode } from "@knightcode/shared";
import { TextAttributes } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../providers/theme";
import { SPINNER_FRAMES } from "../lib/ui/figures";
import { frameAt } from "../lib/ui/spinner-frame";
import { pickVerb, verbForSeed } from "../lib/ui/spinner-verbs";
import { estimateTokens, formatTokenCount } from "../lib/ui/format-tokens";
import { useStall } from "../lib/ui/stall";
import {
  glimmerIndex,
  inGlimmer,
  flashOpacity,
  lighten,
  mixColor,
  type SpinnerMode,
} from "../lib/ui/shimmer";

type Props = {
  mode?: ModeType;
  /** Turn start (ms). Anchors elapsed time so it survives remounts mid-turn. */
  startMs?: number;
  /** Ms spent waiting on the user this turn — subtracted so the clock freezes. */
  getPausedMs?: () => number;
  /** Chars produced so far this turn (text + reasoning) — drives tokens + stall. */
  responseChars?: number;
  /** True while a tool call is executing — drives the tool-use flash. */
  toolActive?: boolean;
  interruptible?: boolean;
  isCompacting?: boolean;
};

// the reference TUI runs its spinner on a 50ms (20fps) animation clock and derives the
// glyph (every 120ms), the glimmer sweep, and the tool-use flash from it.
const TICK_MS = 50;
const GLYPH_INTERVAL_MS = 120;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * the reference TUI's working row: a pulse glyph + a verb whose bright highlight
 * sweeps across the word (ported from Spinner/GlimmerMessage), with a dim
 * "(esc to interrupt · ↓N tokens · Ns)" tail. The sweep runs fast left→right
 * while awaiting the first token, slow right→left while streaming, flashes as a
 * whole during tool use, and reddens when the reply stalls.
 */
export function WorkingIndicator({
  mode = Mode.BUILD,
  startMs,
  getPausedMs,
  responseChars = 0,
  toolActive = false,
  interruptible = false,
  isCompacting = false,
}: Props) {
  const { colors } = useTheme();
  const [mountVerb] = useState(() => pickVerb());
  // Pass toolActive so a running tool (no new text) never reads as a stall.
  const stalled = useStall(responseChars, toolActive);

  // Single 50ms animation clock — re-renders the row; everything else is derived
  // from the wall-clock elapsed time so it stays correct across remounts.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Fall back to mount time only when no turn anchor is supplied.
  const mountRef = useRef(Date.now());
  const start = startMs ?? mountRef.current;
  // Seeded by the turn start so the verb is fixed for the whole turn.
  const verb = startMs != null ? verbForSeed(startMs) : mountVerb;

  const baseColor =
    mode === Mode.PLAN
      ? colors.planMode
      : mode === Mode.AUTO
        ? colors.autoMode
        : colors.primary;

  if (isCompacting) {
    const frame = SPINNER_FRAMES[frameAt(Date.now(), SPINNER_FRAMES.length, GLYPH_INTERVAL_MS)]!;
    return (
      <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1}>
        <text fg={colors.autoMode}>{frame}</text>
        <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
          Compacting context…
        </text>
      </box>
    );
  }

  const paused = getPausedMs?.() ?? 0;
  const elapsedMs = Math.max(0, Date.now() - start - paused);
  const elapsed = formatElapsed(elapsedMs);
  const tokens = estimateTokens(responseChars);

  const frame = SPINNER_FRAMES[frameAt(elapsedMs, SPINNER_FRAMES.length, GLYPH_INTERVAL_MS)]!;
  // the reference TUI pairs each base colour with a lighter "shimmer" colour for the
  // glimmer sweep. Use the themed shimmer where one exists; fall back to a
  // computed lighten for plan mode.
  const shimmerColor =
    mode === Mode.AUTO
      ? colors.autoModeShimmer
      : mode === Mode.PLAN
        ? lighten(baseColor, 0.3)
        : colors.primaryShimmer;

  // the reference TUI's spinner modes: a stalled reply takes priority (red, no shimmer);
  // otherwise tool-use flashes, awaiting-first-token sweeps fast (requesting),
  // and streaming sweeps slow (responding).
  const stalledNow = stalled && !toolActive;
  const spinnerMode: SpinnerMode = toolActive
    ? "tool-use"
    : responseChars > 0
      ? "responding"
      : "requesting";

  const glyphColor = stalledNow ? colors.error : baseColor;
  const verbText = `${verb}…`;

  let verbNode: React.ReactNode;
  if (stalledNow) {
    verbNode = <text fg={colors.error}>{verbText}</text>;
  } else if (spinnerMode === "tool-use") {
    // Whole word flashes between base and shimmer, ~2s sine cycle.
    verbNode = (
      <text fg={mixColor(baseColor, shimmerColor, flashOpacity(elapsedMs))}>
        {verbText}
      </text>
    );
  } else {
    const gi = glimmerIndex(elapsedMs, verbText.length, spinnerMode);
    verbNode = (
      <text>
        {verbText.split("").map((ch, i) => (
          <span key={i} fg={inGlimmer(i, gi) ? shimmerColor : baseColor}>
            {ch}
          </span>
        ))}
      </text>
    );
  }

  const statusParts: string[] = [];
  if (interruptible) statusParts.push("esc to interrupt");
  if (tokens > 0) statusParts.push(`↓ ${formatTokenCount(tokens)} tokens`);
  statusParts.push(elapsed);
  const status = `(${statusParts.join(" · ")})`;

  return (
    <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1}>
      <text fg={glyphColor}>{frame}</text>
      {verbNode}
      <text attributes={TextAttributes.DIM}>{status}</text>
    </box>
  );
}
