import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticBoolean, semanticNumber } from "../primitives";

export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 600_000;

const input_schema = z.object({
  command: z.string().describe("The command to execute"),
  description: z
    .string()
    .optional()
    .describe(
      `Clear, concise description of what this command does in active voice.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`,
    ),
  timeout: semanticNumber(z.number().int().positive().optional()).describe(
    `Optional timeout in milliseconds (default ${BASH_DEFAULT_TIMEOUT_MS}, max ${BASH_MAX_TIMEOUT_MS}).`,
  ),
  run_in_background: semanticBoolean(
    z.boolean().optional().default(false),
  ).describe(
    "Set to true to run this command in the background. You will be notified on completion.",
  ),
  port: semanticNumber(z.number().int().min(1).max(65535).optional()).describe(
    "Optional port that this command binds to. If occupied, the port will be freed before launch.",
  ),
});

export const Bash = defineTool({
  name: "Bash",
  is_read_only: false,
  is_concurrency_safe: false,
  visibility: "build_only",
  search_hint: "run a shell command",
  input_schema,
  description: `Run a shell command in the project directory. The shell is chosen automatically based on the OS (PowerShell on Windows, the user's $SHELL on Unix).

IMPORTANT — Use dedicated tools instead of Bash for these operations:
- File search → use the Glob tool, NOT find
- Content search → use the Grep tool, NOT grep or rg
- Read files → use the Read tool, NOT cat, head, or tail
- Edit files → use the Edit/Write tools, NOT sed or awk
- Communication → output text directly, NOT echo or printf

Instructions:
- Always quote file paths that contain spaces with double quotes.
- Try to maintain your current working directory by using absolute paths and avoiding cd.

Multiple commands:
- If the commands are independent, make MULTIPLE separate Bash tool calls in a single message (parallel execution).
- If the commands depend on each other, use a single Bash call with '&&' to chain them.
- Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.

Background tasks:
- Use run_in_background: true for servers or long-running processes. You will be notified on completion.
- If your command is long running, use run_in_background. No sleep needed.
- Do not retry failing commands in a sleep loop — diagnose the root cause.

Git workflow:
- Never run git commit unless the user explicitly asks you to commit.
- Always create new commits (never amend) unless the user explicitly requests an amend.
- Never use --force, --no-verify, or --no-gpg-sign unless explicitly requested.
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) — they require interactive input.
- When committing: run git status + git diff in parallel first, then commit with a clear message.`,
});

export type BashInput = z.infer<typeof input_schema>;
