import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  notebook_path: z
    .string()
    .describe("Path to the Jupyter notebook file to edit (.ipynb)"),
  cell_id: z
    .string()
    .optional()
    .describe(
      "Stable cell ID to target. When inserting, the new cell is inserted after the cell with this ID, or at the beginning if not specified. Prefer cell_id over cell_number — IDs are stable across edits while numbers shift.",
    ),
  cell_number: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Fallback: 0-indexed cell position. Used only when the notebook has no cell IDs. Prefer cell_id for new notebooks.",
    ),
  new_source: z
    .string()
    .optional()
    .describe(
      "The new source code/text for the cell. Required for replace and insert.",
    ),
  cell_type: z
    .enum(["code", "markdown"])
    .optional()
    .describe(
      "The type of cell (code or markdown). Required for insert. Defaults to existing cell type for replace.",
    ),
  edit_mode: z
    .enum(["replace", "insert", "delete"])
    .optional()
    .default("replace")
    .describe(
      "'replace' (default) replaces cell contents, 'insert' adds a new cell after the target, 'delete' removes the cell.",
    ),
});

export const NotebookEdit = defineTool({
  name: "NotebookEdit",
  is_deferred: true,
  is_read_only: false,
  is_concurrency_safe: false,
  visibility: "build_only",
  search_hint: "edit a Jupyter notebook cell",
  input_schema,
  description: `Replace, insert, or delete a cell in a Jupyter notebook (.ipynb file).

Usage:
- notebook_path must be a path to an existing .ipynb file.
- Prefer cell_id (stable across edits) over cell_number (shifts after insert/delete).
- Use edit_mode='replace' (default) to replace cell contents.
- Use edit_mode='insert' to add a new cell after the target. cell_type is required for insert.
- Use edit_mode='delete' to delete the target cell.
- You MUST read the notebook with Read before editing it.
- For editing other file types, use the Edit tool instead.`,
});

export type NotebookEditInput = z.infer<typeof input_schema>;
