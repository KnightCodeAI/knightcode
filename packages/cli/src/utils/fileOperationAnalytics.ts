// TODO: file-operation analytics land never (out of scope) — see the
// out-of-scope subsystems decision. This inert sink keeps the tool call sites
// unchanged.

export function logFileOperation(_params: {
  operation: 'read' | 'write' | 'edit'
  tool: 'FileReadTool' | 'FileWriteTool' | 'FileEditTool'
  filePath: string
  content?: string
  type?: 'create' | 'update'
}): void {}
