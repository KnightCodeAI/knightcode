/**
 * Memory prompts. The forked extraction agent persists via the **Memory tool**
 * (list/update/delete) rather than writing files directly, because knightcode's
 * file tools are sandboxed to the project root and memory lives outside it.
 */

/** The four-type memory taxonomy. */
const TYPES_SECTION = `## Types of memory

There are four discrete types of memory you can store:

<types>
<type>
  <name>user</name>
  <description>Information about the user's role, goals, responsibilities, and knowledge. Great user memories let you tailor future behavior to the user's preferences and perspective — you collaborate differently with a senior engineer than with a first-time coder. Avoid memories that read as negative judgements or that aren't relevant to the work.</description>
  <when_to_save>When you learn details about the user's role, preferences, responsibilities, or knowledge.</when_to_save>
  <examples>
  user: I've been writing Go for ten years but this is my first time touching the React side of this repo
  → user memory: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues
  </examples>
</type>
<type>
  <name>feedback</name>
  <description>Guidance the user has given about HOW to approach work — both what to avoid and what to keep doing. Record from failure AND success: if you only save corrections you drift away from approaches the user already validated. Include *why* so you can judge edge cases later.</description>
  <when_to_save>Any time the user corrects your approach ("no, not that", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "keep doing that"). Corrections are easy to notice; confirmations are quieter — watch for them.</when_to_save>
  <body_structure>Lead with the rule, then a **Why:** line (the reason the user gave) and a **How to apply:** line (when/where it kicks in).</body_structure>
  <examples>
  user: don't mock the database in these tests — we got burned when mocked tests passed but the prod migration failed
  → feedback memory: integration tests must hit a real database, not mocks. **Why:** prior incident where mock/prod divergence masked a broken migration. **How to apply:** any test touching DB code
  </examples>
</type>
<type>
  <name>project</name>
  <description>Ongoing work, goals, initiatives, bugs, or incidents not derivable from the code or git history. Helps you understand the broader context and motivation behind the user's work.</description>
  <when_to_save>When you learn who is doing what, why, or by when. Always convert relative dates to absolute (e.g., "Thursday" → "2026-06-18") so the memory stays interpretable.</when_to_save>
  <body_structure>Lead with the fact/decision, then **Why:** and **How to apply:** lines.</body_structure>
  <examples>
  user: we're freezing non-critical merges after Thursday — mobile is cutting a release branch
  → project memory: merge freeze begins 2026-06-18 for the mobile release cut. **How to apply:** flag any non-critical PR work scheduled after that date
  </examples>
</type>
<type>
  <name>reference</name>
  <description>Pointers to where information lives in external systems, so you remember where to look for up-to-date info outside the project.</description>
  <when_to_save>When you learn about an external resource and its purpose (a Linear project, a Slack channel, a dashboard URL).</when_to_save>
  <examples>
  user: pipeline bugs are tracked in the Linear project "INGEST"
  → reference memory: pipeline bugs are tracked in Linear project "INGEST"
  </examples>
</type>
</types>`;

/** What NOT to save. */
const WHAT_NOT_TO_SAVE = `## What NOT to save

- Code patterns, conventions, architecture, file paths, or project structure — derivable by reading the project.
- Git history, recent changes, or who-changed-what — git log / git blame are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit has the context.
- Anything already in KNIGHTCODE.md / project rules.
- Ephemeral task details: in-progress work, temporary state, current conversation context.

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.`;

/**
 * Recall-side guidance, injected into the main system prompt alongside the
 * Memory Index, telling the model how to treat a recalled memory.
 */
export const BEFORE_RECOMMENDING_FROM_MEMORY = `When the user asks you to *ignore* or *not use* memory, proceed as if the Memory Index were empty — do not apply, cite, or compare against remembered facts.

A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*; it may have been renamed, removed, or never merged. Before recommending from a memory: if it names a file path, check the file exists; if it names a function or flag, grep for it; if the user is about to act on your recommendation, verify first. "The memory says X exists" is not "X exists now." If a recalled memory conflicts with what you observe now, trust what you observe — and use the Memory tool to update or remove the stale entry.`;

/**
 * Build the consolidation ("dream") prompt — a reflective pass that merges,
 * de-duplicates, and prunes the memory store. Operates through the Memory tool
 * (the memory dir is outside the project root, so Read/Grep can't reach it).
 */
export function buildConsolidationPrompt(manifest: string): string {
  const existing =
    manifest.trim().length > 0
      ? `\n\n## Current memories\n\n${manifest}`
      : "\n\n(No memories saved yet.)";

  return [
    "# Memory consolidation",
    "",
    "You are performing a reflective pass over your saved memories — merging duplicates, pruning stale entries, and tightening descriptions so future sessions orient quickly. Work entirely through the **Memory** tool.",
    "",
    "## Tools",
    '- `Memory(action:"list")` — names + descriptions of every memory.',
    '- `Memory(action:"get", name)` — a memory\'s full body (the list only shows descriptions; read bodies before merging so you don\'t lose content).',
    '- `Memory(action:"update", name, type, description, body)` — create or overwrite. Reuse an existing name to merge into it.',
    '- `Memory(action:"delete", name)` — remove a stale, wrong, or superseded memory.',
    "",
    "## Process",
    "1. **Orient** — `list` to see everything, then `get` the bodies of any that look related or overlapping.",
    "2. **Merge** — when two or more memories cover the same topic, combine them into one (update one with the merged body, delete the others). Prefer fewer, denser memories over many near-duplicates.",
    "3. **Prune** — delete memories that are stale, contradicted, or no longer useful. Convert any relative dates to absolute.",
    "4. **Tighten** — fix vague descriptions (they drive recall) and keep bodies focused.",
    "",
    "Follow the type taxonomy and 'what NOT to save' rules from your system prompt. Make changes only when they clearly improve the store — if memories are already tight, do nothing. Do not narrate; just make the changes and stop.",
    existing,
  ].join("\n");
}

/**
 * Build the extraction-subagent prompt. `manifest` is the existing-memory listing.
 */
export function buildExtractionPrompt(
  newMessageCount: number,
  manifest: string,
): string {
  const existing =
    manifest.trim().length > 0
      ? `\n\n## Existing memories\n\n${manifest}\n\nCheck this list before saving — update an existing memory (reuse its exact name) rather than creating a duplicate.`
      : "";

  return [
    `You are now acting as the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages above and use them to update your persistent memory.`,
    "",
    "Persist memories with the **Memory** tool: `Memory(action:\"list\")` to review what exists, `Memory(action:\"update\", name, type, description, body)` to save or update one, `Memory(action:\"delete\", name)` to forget one. You also have Read/Grep/Glob if you need to verify a detail before saving — but do not rabbit-hole; you have a limited turn budget.",
    "",
    "If the user explicitly asked you to remember something, save it as whichever type fits best. If they asked you to forget something, delete the relevant entry. Otherwise, save only durable, non-obvious facts — most turns yield nothing, and saving nothing is correct and common.",
    "",
    TYPES_SECTION,
    "",
    WHAT_NOT_TO_SAVE,
    "",
    "## How to save",
    "- One memory per `Memory(update)` call; give each a short kebab-case `name`, a specific one-line `description` (used for later recall), the right `type`, and the `body`.",
    "- For feedback/project memories, structure the body as: the rule/fact, then a **Why:** line and a **How to apply:** line.",
    "- Organize by topic, not chronologically. Update or remove memories that are now wrong. Never create a duplicate of an existing memory.",
    `- Use only content from the last ~${newMessageCount} messages. When you are done, stop — do not narrate.`,
    existing,
  ].join("\n");
}
