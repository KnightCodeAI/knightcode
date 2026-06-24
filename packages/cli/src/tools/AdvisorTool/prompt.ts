// Prompts for the client-side advisor tool. The advisor is a stronger (or
// simply separate) "reviewer" model that sees the whole conversation and
// returns advice. Upstream this is a first-party *server* tool; under BYOK we
// reconstruct the same behavior locally by forwarding the transcript to the
// user-configured reviewer model via sideQuery().

/** One-line capability phrase shown in the tool schema / ToolSearch. */
export const ADVISOR_DESCRIPTION =
  'Consult a stronger reviewer model for advice on the current task'

/**
 * System prompt for the reviewer model. It is given the full conversation
 * transcript and asked to act as a senior advisor — orient, then give
 * pointed, actionable guidance. Kept terse on purpose: the value is in the
 * judgment, not the prose.
 */
export const ADVISOR_REVIEWER_SYSTEM_PROMPT = `You are a senior engineering advisor reviewing another AI agent's work in progress.

You are given the full transcript of the agent's session so far: the user's task, every tool call the agent made, and every result it saw. The agent has paused to ask for your advice before continuing.

Your job is to give the agent its best next move. Be direct and concrete.

- Lead with the single most important thing the agent should do or reconsider.
- Call out wrong assumptions, missed evidence, or a flawed approach — cite the specific tool result or file that shows it.
- If the agent is on the right track, say so plainly and name the one risk most likely to bite.
- Prefer specifics ("the test at X asserts Y, but the code does Z") over generic advice.
- Do not rewrite the whole solution. Point; don't reimplement.
- If the transcript lacks the information needed to judge, say exactly what the agent should go find first.

Keep it tight — a few short paragraphs or a short list. No preamble, no flattery.`

/** Wraps the serialized transcript in the user turn sent to the reviewer. */
export function buildAdvisorUserPrompt(transcript: string): string {
  return `Here is the agent's session transcript so far:

<transcript>
${transcript}
</transcript>

Review the transcript above and give the agent your advice for what to do next.`
}
