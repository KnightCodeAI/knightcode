import { ALL_TOOL_NAMES } from "@knightcode/shared";
import { loadProjectContextSync } from "../context/project-context";
import { loadRulesText } from "../context/rules";
import { buildSkillIndex } from "../context/skills";
import { loadGitContext } from "../git/git-context";
import { detectProjectStackSync } from "../project-detection";
import { detectShell } from "../shell";
import { loadAgents, formatAgentLines } from "../agents/loader";
import { hasIncompleteTasksSync } from "../tools";

export type RequestContext = {
  globalInstructions?: string;
  projectInstructions?: string;
  localInstructions?: string;
  rules?: string;
  skillIndex?: string;
  gitBranchName?: string;
  gitStatus?: string;
  gitDiffSummary?: string;
  frameworks: string[];
  packageManager?: string;
  isTypeScript: boolean;
  shellName: string;
  platform: string;
  hasPersistedTasks: boolean;
  agentTypes: string;
};

/** Gather the per-turn workspace context the system prompt is built from. */
export function buildRequestContext(cwd: string): RequestContext {
  const projectCtx = loadProjectContextSync(cwd);
  const gitCtx = loadGitContext(cwd);
  const stackCtx = detectProjectStackSync(cwd);
  return {
    globalInstructions: projectCtx.globalInstructions,
    projectInstructions: projectCtx.projectInstructions,
    localInstructions: projectCtx.localInstructions,
    rules: loadRulesText(cwd),
    skillIndex: buildSkillIndex(cwd),
    gitBranchName: gitCtx.branchName,
    gitStatus: gitCtx.status,
    gitDiffSummary: gitCtx.diffSummary,
    frameworks: stackCtx.frameworks,
    packageManager: stackCtx.packageManager,
    isTypeScript: stackCtx.isTypeScript,
    shellName: detectShell().name,
    platform: process.platform,
    hasPersistedTasks: hasIncompleteTasksSync(cwd),
    agentTypes: formatAgentLines(loadAgents(cwd), [...ALL_TOOL_NAMES]),
  };
}
