import { computeLineDiff } from "../git/diff";

/** Count added/removed lines between two strings (the reference TUI's diff summary). */
export function diffSummary(
  oldString: string,
  newString: string,
): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of computeLineDiff(oldString, newString)) {
    if (line.type === "added") additions += 1;
    else if (line.type === "deleted") removals += 1;
  }
  return { additions, removals };
}
