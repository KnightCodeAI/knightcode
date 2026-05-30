import type { Skill } from "../../skills";

const STUCK_BODY = `# Stuck: Diagnose Frozen or Slow KnightCode Sessions

Help the user diagnose if a KnightCode session, background process, or subprocess is frozen, hung, or consuming excessive CPU or memory.

## Diagnostic Steps

1. **Check KnightCode Processes Registry:** Read the background processes registry file at \`.knightcode/processes.json\`.
2. **List Running Processes:**
   * On Windows: Run \`tasklist /FI "IMAGENAME eq bun*"\` or \`tasklist /FI "IMAGENAME eq node*"\`.
   * On macOS/Linux: Run \`ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '(knightcode|cli|bun|node)'\`.
3. **Analyze Resource Utilization:**
   * Look for persistent high CPU (>=90%) indicative of infinite loops.
   * Look for stopped or zombie process states (\`T\` or \`Z\`).
   * Check for massive memory footprint (>=4GB RSS).
4. **Identify Blocked Subprocesses:** Identify any child subprocesses (e.g., \`git\`, compilers, formatters) spawned by the main session that might be hung waiting for input or locked resources.
5. **Report findings:** Display a clear breakdown of running processes, CPU/Memory stats, and any identified hangs to the user. Do not kill any process unless explicitly asked by the user.
`;

export const stuckSkill: Skill = {
  name: "stuck",
  description:
    "Diagnose frozen or slow background tasks and process executions.",
  userInvocable: true,
  disableModelInvocation: false,
  source: "bundled",
  dirPath: "",
  body: STUCK_BODY,
};
