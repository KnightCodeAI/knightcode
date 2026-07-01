export const GLOB_TOOL_NAME = 'Glob'

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Respects .gitignore (e.g. node_modules, build output, and dist are excluded). To find an ignored file, target it by an explicit path.
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`
