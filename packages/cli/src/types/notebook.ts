// Minimal Jupyter notebook (.ipynb) model — the fields the NotebookEdit tool and
// its diff view read and write. The full nbformat schema is broader; these are
// the load-bearing members.
export interface NotebookCell {
  id?: string
  cell_type?: 'code' | 'markdown'
  source: string | string[]
  metadata?: Record<string, unknown>
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
}
export interface NotebookCellOutput {
  [key: string]: unknown
}
export interface NotebookCellSource {}
export interface NotebookCellSourceOutput {}
export interface NotebookCellType {}
export interface NotebookContent {
  cells: NotebookCell[]
  metadata: { language_info?: { name?: string }; [key: string]: unknown }
  nbformat: number
  nbformat_minor: number
}
export interface NotebookOutputImage {}
