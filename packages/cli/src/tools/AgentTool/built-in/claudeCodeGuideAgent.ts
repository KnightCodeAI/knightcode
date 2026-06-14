// TODO: the full claude-code-guide built-in agent definition lands when the
// built-in agent registry is wired. The only in-scope consumer (the /debug
// bundled skill) needs just the agent-type identifier, so that is all this
// module exposes for now.
export const CLAUDE_CODE_GUIDE_AGENT_TYPE = 'claude-code-guide'
