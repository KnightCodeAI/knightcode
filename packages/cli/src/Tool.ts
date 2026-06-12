// TODO: the full tool interface (Tool, ToolUseContext, input validation,
// lookup helpers) lands with the tool layer; only the types the message
// utilities reference live here for now.

/** Data payload carried by a progress message. */
export type Progress = { type: string }
