/**
 * A file-edit diff body should only be shown once the edit actually applied —
 * i.e. the tool part reached terminal success (`output-available`) with no
 * error. A failed/invalid/rejected edit, or one still in flight, shows no diff:
 * green/red lines for a change that never happened (or hasn't happened yet) are
 * misleading. Mirrors the AskUserQuestion renderer, which reveals its result
 * only on `output-available`.
 */
export function shouldRenderDiffBody(
  state: string | undefined,
  errorText: string | undefined,
): boolean {
  return state === "output-available" && !errorText;
}
