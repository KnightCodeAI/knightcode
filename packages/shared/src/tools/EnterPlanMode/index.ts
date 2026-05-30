import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({});

export const EnterPlanMode = defineTool({
  name: "EnterPlanMode",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: false,
  search_hint: "enter plan mode",
  input_schema,
  description: `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

When to Use:
- New feature implementation requiring architectural decisions
- Multiple valid approaches exist and the choice meaningfully affects the codebase
- Code modifications that affect existing behavior or structure
- Multi-file changes (more than 2-3 files)
- Unclear requirements that need exploration before implementation
- User preferences matter — the implementation could reasonably go multiple ways

When NOT to Use:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks
- Simple tasks with obvious implementation

What Happens in Plan Mode:
1. Thoroughly explore the codebase using Glob, Grep, and Read.
2. Understand existing patterns and architecture.
3. Design an implementation approach.
4. Present your plan to the user for approval.
5. Use AskUserQuestion if you need to clarify approaches.
6. Exit plan mode with ExitPlanMode when ready to implement.`,
});

export type EnterPlanModeInput = z.infer<typeof input_schema>;
