import type { Skill } from "../../skills";

const REMEMBER_BODY = `# Memory Review: Project Context Preservation

Review the active goals, constraints, conventions, and learnings from this session, and propose promotions to KNIGHTCODE.md or KNIGHTCODE.local.md.

## Steps

### 1. Gather context
Read KNIGHTCODE.md and KNIGHTCODE.local.md from the project root (if they exist) to see what is already recorded.

### 2. Identify new rules and conventions
Identify any rules, style preferences, build/test scripts, or design patterns that were established or heavily steering the work in this session.

### 3. Classify promotions
Determine the best destination for each key learning or rule:

| Destination | What belongs there |
|---|---|
| **KNIGHTCODE.md** | Project conventions, styles, build instructions, and guidelines that all project contributors should follow. |
| **KNIGHTCODE.local.md** | Personal preferences, local build directories, private configurations, or personal prompts specific to this machine/user. |
| **Global (~/.knightcode/KNIGHTCODE.md)** | General preferences across all projects on this machine. |

### 4. Present the report
Output a structured report proposing changes (e.g. additions/modifications to the files) to the user. Present all proposals clearly and ask for the user's confirmation before modifying any files.
`;

export const rememberSkill: Skill = {
  name: "remember",
  description:
    "Review recent session context and propose promotions to KNIGHTCODE.md or KNIGHTCODE.local.md.",
  userInvocable: true,
  disableModelInvocation: false,
  source: "bundled",
  dirPath: "",
  body: REMEMBER_BODY,
};
