/**
 * Identifies which subsystem initiated a model query. Used for analytics
 * dimensions, retry policy tweaks, and prompt-cache key separation.
 *
 * 'repl_main_thread' is the interactive conversation; everything else is a
 * background or utility query (summaries, compaction, hooks, subagents, …).
 */
export type QuerySource =
  | 'agent_creation'
  | 'agent_summary'
  | 'auto_dream'
  | 'auto_mode'
  | 'auto_mode_critique'
  | 'away_summary'
  | 'bash_extract_prefix'
  | 'chrome_mcp'
  | 'compact'
  | 'extract_memories'
  | 'feedback'
  | 'generate_session_title'
  | 'hook_agent'
  | 'hook_prompt'
  | 'insights'
  | 'magic_docs'
  | 'marble_origami'
  | 'mcp_datetime_parse'
  | 'memdir_relevance'
  | 'model_validation'
  | 'permission_explainer'
  | 'prompt_suggestion'
  | 'rename_generate_name'
  | 'repl_main_thread'
  | 'sdk'
  | 'session_memory'
  | 'session_search'
  | 'side_question'
  | 'skill_improvement_apply'
  | 'speculation'
  | 'teleport_generate_title'
  | 'tool_use_summary_generation'
  | 'unknown'
  | 'verification_agent'
  | 'web_fetch_apply'
  | 'web_search_tool'
