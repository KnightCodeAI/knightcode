import { z } from "zod";
import { tool } from "ai";

export const Mode = {
  BUILD: "BUILD",
  PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export const toolInputSchemas = {
  readFile: z.object({
    path: z.string().describe("Relative path to the file to read"),
    offset: z
      .int()
      .min(0)
      .optional()
      .describe("Starting line number (0-indexed) for paginated reading"),
    limit: z
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of lines to return (default 200)"),
  }),
  listDirectory: z.object({
    path: z.string().default(".").describe("Relative directory path to list"),
  }),
  glob: z.object({
    pattern: z.string().describe("Glob pattern to match files"),
    path: z.string().default(".").describe("Directory to search from"),
  }),
  grep: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().default(".").describe("Directory to search from"),
    include: z
      .string()
      .optional()
      .describe("Optional glob for files to include, e.g. '*.ts'"),
    caseInsensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe("Case insensitive search"),
    contextLines: z
      .number()
      .optional()
      .describe("Lines of context around each match (before and after)"),
    outputMode: z
      .enum(["content", "files", "count"])
      .optional()
      .default("content")
      .describe(
        "'content' shows matching lines, 'files' lists filenames, 'count' shows match counts",
      ),
    maxResults: z
      .number()
      .optional()
      .default(200)
      .describe("Max results to return (default 200)"),
  }),
  writeFile: z.object({
    path: z.string().describe("Relative path to write"),
    content: z.string().describe("File contents"),
  }),
  editFile: z.object({
    path: z.string().describe("Relative path to edit"),
    oldString: z
      .string()
      .min(1)
      .describe(
        "Exact text to replace; must be unique unless replaceAll is true",
      ),
    newString: z.string().describe("Replacement text"),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences"),
  }),
  bash: z.object({
    command: z.string().describe("Shell command to run"),
    description: z
      .string()
      .optional()
      .describe("Short description of the command"),
    timeout: z.int().min(1).optional().describe("Timeout in milliseconds"),
    runInBackground: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to run the command in the background"),
    port: z
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe(
        "Optional port that this command binds to. If occupied, port check will free it or fail.",
      ),
  }),
  webSearch: z.object({
    query: z.string().describe("Search query to run on the web"),
    maxResults: z
      .int()
      .min(0)
      .max(20)
      .optional()
      .default(5)
      .describe(
        "Maximum number of search results to return (default 5, max 20)",
      ),
  }),
  todoWrite: z.object({
    items: z
      .array(
        z.object({
          id: z.string().describe("Unique ID for this todo item"),
          label: z.string().describe("Short label describing the task"),
          status: z
            .enum(["pending", "in_progress", "completed"])
            .describe("Current status of the task"),
        }),
      )
      .describe("List of progress items to display"),
  }),
  webFetch: z.object({
    url: z.string().url().describe("URL to fetch and convert to text"),
    maxLength: z
      .number()
      .optional()
      .default(20000)
      .describe("Maximum character length of returned text (default 20000)"),
  }),
  AskUserQuestion: z.object({
    question: z.string().describe("The main question to ask the user"),
    options: z
      .array(z.string())
      .min(2)
      .describe("A list of options to present to the user"),
    isMultiSelect: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether the user can select multiple options (true means checkboxes, false means radio buttons)",
      ),
  }),
  gitStatus: z.object({}),
  gitDiff: z.object({
    path: z
      .string()
      .optional()
      .describe("Optional relative path to restrict the diff to"),
  }),
  gitLog: z.object({
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of commits to return (default 10)"),
  }),
} as const;

export const readOnlyToolContracts = {
  readFile: tool({
    description:
      "Read a file from the current project directory. Supports optional line-based pagination via offset and limit.",
    inputSchema: toolInputSchemas.readFile,
  }),
  listDirectory: tool({
    description:
      "List entries in a directory under the current project directory.",
    inputSchema: toolInputSchemas.listDirectory,
  }),
  glob: tool({
    description:
      "Find files matching a glob pattern under the current project directory.",
    inputSchema: toolInputSchemas.glob,
  }),
  grep: tool({
    description:
      "Search file contents with a regular expression under the current project directory.",
    inputSchema: toolInputSchemas.grep,
  }),
  webSearch: tool({
    description: "Search the web for information using Tavily.",
    inputSchema: toolInputSchemas.webSearch,
  }),
  todoWrite: tool({
    description:
      "Update the progress checklist displayed to the user. Call this to show task progress.",
    inputSchema: toolInputSchemas.todoWrite,
  }),
  webFetch: tool({
    description:
      "Fetch a web page and return its content as plain text. Useful for reading documentation, articles, and web pages.",
    inputSchema: toolInputSchemas.webFetch,
  }),
  AskUserQuestion: tool({
    description:
      "Ask the user a clarifying or design question using a multiple choice prompt with optional write-in custom answer.",
    inputSchema: toolInputSchemas.AskUserQuestion,
  }),
  gitStatus: tool({
    description: "Get the status of files in the current git repository.",
    inputSchema: toolInputSchemas.gitStatus,
  }),
  gitDiff: tool({
    description: "Get git diff showing changes in the repository.",
    inputSchema: toolInputSchemas.gitDiff,
  }),
  gitLog: tool({
    description: "Show commit logs from the git repository.",
    inputSchema: toolInputSchemas.gitLog,
  }),
} as const;

export const buildToolContracts = {
  ...readOnlyToolContracts,
  writeFile: tool({
    description:
      "Create or overwrite a file under the current project directory.",
    inputSchema: toolInputSchemas.writeFile,
  }),
  editFile: tool({
    description:
      "Replace exact text in a file under the current project directory.",
    inputSchema: toolInputSchemas.editFile,
  }),
  bash: tool({
    description: "Run a shell command in the current project directory.",
    inputSchema: toolInputSchemas.bash,
  }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
  return mode === Mode.PLAN ? readOnlyToolContracts : buildToolContracts;
}
