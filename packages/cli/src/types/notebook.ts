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
export type NotebookCellType = 'code' | 'markdown'

/** An image decoded from a cell's rich output (display_data/execute_result). */
export interface NotebookOutputImage {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

/** A processed cell output: flattened text plus an optional decoded image. */
export interface NotebookCellSourceOutput {
  output_type: string
  text: string
  image?: NotebookOutputImage
}

/** A processed notebook cell ready for rendering into a tool result. */
export interface NotebookCellSource {
  cellType: string
  source: string
  language?: string
  execution_count?: number
  cell_id: string
  outputs?: NotebookCellSourceOutput[]
}

export interface NotebookContent {
  cells: NotebookCell[]
  metadata: { language_info?: { name?: string }; [key: string]: unknown }
  nbformat: number
  nbformat_minor: number
}
