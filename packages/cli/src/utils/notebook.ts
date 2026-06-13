// TODO: Jupyter notebook reading isn't ported. The Read tool routes .ipynb
// files here; until the notebook parser lands, reading one is unsupported.

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

/** One notebook cell with its source and (optional) rendered outputs. */
export type NotebookCellSource = {
  cell: number
  cellType: string
  source: string
  language: string
  execution_count?: number
  [key: string]: unknown
}

export async function readNotebook(
  _notebookPath: string,
  _cellId?: string,
): Promise<NotebookCellSource[]> {
  throw new Error('Reading Jupyter notebooks is not supported in this build.')
}

export function mapNotebookCellsToToolResult(
  _data: NotebookCellSource[],
  _toolUseID: string,
): ToolResultBlockParam {
  throw new Error('Reading Jupyter notebooks is not supported in this build.')
}
