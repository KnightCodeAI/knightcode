// TODO: doctor context warnings — flags oversized CLAUDE.md / unreachable
// permission rules in `claude doctor`. The context-analysis pass isn't ported,
// so no warnings are produced. The warning fields are typed so the display
// loops over `.details` resolve.

type Warning = { message: string; details: any[] }

export type ContextWarnings = {
  unreachableRulesWarning?: Warning
  claudeMdWarning?: Warning
  agentWarning?: Warning
  mcpWarning?: Warning
  [key: string]: any
}

export async function checkContextWarnings(
  ..._args: unknown[]
): Promise<ContextWarnings> {
  return {}
}
