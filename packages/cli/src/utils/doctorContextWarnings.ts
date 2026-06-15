// TODO: doctor context warnings — flags oversized KNIGHTCODE.md / unreachable
// permission rules in `knightcode doctor`. The context-analysis pass isn't ported,
// so no warnings are produced. The warning fields are typed so the display
// loops over `.details` resolve.

type Warning = { message: string; details: any[] }

export type ContextWarnings = {
  unreachableRulesWarning?: Warning
  knightcodeMdWarning?: Warning
  agentWarning?: Warning
  mcpWarning?: Warning
  [key: string]: any
}

export async function checkContextWarnings(
  ..._args: unknown[]
): Promise<ContextWarnings> {
  return {}
}
