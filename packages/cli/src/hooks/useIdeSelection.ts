// TODO: live IDE selection bridging (subscribing to the editor's current
// selection over the IDE connection) is not implemented yet. The attachment
// pipeline carries the selection shape into each turn; only the type lives here.
export type IDESelection = {
  lineCount: number
  lineStart?: number
  text?: string
  filePath?: string
}
