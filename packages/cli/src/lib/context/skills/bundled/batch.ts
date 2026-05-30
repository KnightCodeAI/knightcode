import type { Skill } from "../../skills";

const BATCH_BODY = `# Batch: Parallel Work Orchestration

Orchestrate a large, parallelizable change across this codebase.

## Steps

### Phase 1: Research and Plan
1. **Understand the scope.** Use search/grep tools to research what this change touches. Identify all files, call sites, and patterns that need to change.
2. **Decompose into independent units.** Break the work down into 5-30 self-contained, independent units. Each unit must:
   - Be independently implementable on its own.
   - Be mergeable on its own without landing sibling PRs first.
   - Be roughly uniform in size.
3. **Determine verification plan.** Formulate how each worker will test and verify their changes.
4. **Write the plan.** Present a clear, numbered plan of units to the user for feedback and approval.

### Phase 2: Spawn Workers (After Plan Approval)
Once approved, spawn background agents/subagents for each work unit using sequential/parallel tasks. Provide each worker with a self-contained instruction detailing its files and overall goal.

### Phase 3: Track Progress
Monitor and report the completion status of each work unit in a status table.
`;

export const batchSkill: Skill = {
  name: "batch",
  description:
    "Research and plan a large-scale change, then execute it in parallel across subagents.",
  userInvocable: true,
  disableModelInvocation: true,
  source: "bundled",
  dirPath: "",
  body: BATCH_BODY,
};
