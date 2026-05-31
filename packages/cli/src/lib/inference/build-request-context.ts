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

/** The expensive-to-compute, rarely-changing slice of the context. */
type StaticRequestContext = Omit<
  RequestContext,
  "gitBranchName" | "gitStatus" | "gitDiffSummary" | "hasPersistedTasks"
>;

let staticCache: { cwd: string; value: StaticRequestContext } | undefined;

function buildStaticContext(cwd: string): StaticRequestContext {
  const projectCtx = loadProjectContextSync(cwd);
  const stackCtx = detectProjectStackSync(cwd);
  return {
    globalInstructions: projectCtx.globalInstructions,
    projectInstructions: projectCtx.projectInstructions,
    localInstructions: projectCtx.localInstructions,
    rules: loadRulesText(cwd),
    skillIndex: buildSkillIndex(cwd),
    frameworks: stackCtx.frameworks,
    packageManager: stackCtx.packageManager,
    isTypeScript: stackCtx.isTypeScript,
    shellName: detectShell().name,
    platform: process.platform,
    agentTypes: formatAgentLines(loadAgents(cwd), [...ALL_TOOL_NAMES]),
  };
}

/**
 * Drop the cached static context so the next `buildRequestContext` re-scans the
 * workspace — call after instructions/skills/agents change mid-session.
 */
export function invalidateRequestContextCache(): void {
  staticCache = undefined;
}

/**
 * Gather the per-turn workspace context the system prompt is built from.
 *
 * The instructions, skills, stack, shell and agent scans rarely change within a
 * session, so they are memoized per `cwd` (invalidated on cwd change or via
 * `invalidateRequestContextCache`). The volatile parts — git branch/status/diff
 * and whether tasks are pending — are refreshed on every call.
 */
export function buildRequestContext(cwd: string): RequestContext {
  if (!staticCache || staticCache.cwd !== cwd) {
    staticCache = { cwd, value: buildStaticContext(cwd) };
  }
  const gitCtx = loadGitContext(cwd);
  return {
    ...staticCache.value,
    gitBranchName: gitCtx.branchName,
    gitStatus: gitCtx.status,
    gitDiffSummary: gitCtx.diffSummary,
    hasPersistedTasks: hasIncompleteTasksSync(cwd),
  };
}
