// TODO: the full Jupyter notebook model lands with the NotebookEdit tool. Only
// the fields the notebook diff view reads (cell id/source) are modelled today.
export interface NotebookCell {
  id?: string
  source: string | string[]
}
export interface NotebookCellOutput {}
export interface NotebookCellSource {}
export interface NotebookCellSourceOutput {}
export interface NotebookCellType {}
export interface NotebookContent {
  cells: NotebookCell[]
}
export interface NotebookOutputImage {}
