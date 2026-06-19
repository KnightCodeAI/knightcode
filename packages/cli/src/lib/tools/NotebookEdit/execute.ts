import { readFile, writeFile } from "fs/promises";
import { extname, relative } from "path";
import { NotebookEdit, type KnightcodeTool } from "@repo/shared";
import {
  assertSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import { recordOriginalContent } from "../shared/session-snapshot";
import { assertWritable, recordWrite } from "../shared/file-ledger";

interface NotebookCell {
  id?: string;
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: unknown[];
}

interface Notebook {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

export const tool: KnightcodeTool = NotebookEdit;

function findCellIndex(
  notebook: Notebook,
  cell_id: string | undefined,
  cell_number: number | undefined,
): number {
  if (cell_id !== undefined) {
    const idx = notebook.cells.findIndex((c) => c.id === cell_id);
    if (idx === -1) {
      throw new Error(
        `Cell with id "${cell_id}" not found. Use Read on the notebook first to see available cell IDs.`,
      );
    }
    return idx;
  }
  if (cell_number === undefined) {
    throw new Error("Either cell_id or cell_number is required.");
  }
  if (cell_number < 0 || cell_number >= notebook.cells.length) {
    throw new Error(
      `Cell ${cell_number} does not exist. Notebook has ${notebook.cells.length} cells (0-indexed).`,
    );
  }
  return cell_number;
}

export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
  const {
    notebook_path,
    cell_id,
    cell_number,
    new_source,
    cell_type,
    edit_mode,
  } = NotebookEdit.input_schema.parse(input);

  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, notebook_path, true);
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved);

  if (extname(resolved) !== ".ipynb") {
    throw new Error(
      "File must be a Jupyter notebook (.ipynb file). For other file types, use the Edit tool.",
    );
  }

  await recordOriginalContent(ctx.sessionId, resolved);
  const raw = await readFile(resolved, "utf-8");
  let notebook: Notebook;
  try {
    notebook = JSON.parse(raw);
  } catch {
    throw new Error("Notebook is not valid JSON.");
  }
  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    throw new Error("Notebook does not contain a valid cells array.");
  }

  if (edit_mode === "delete") {
    const idx = findCellIndex(notebook, cell_id, cell_number);
    notebook.cells.splice(idx, 1);
  } else if (edit_mode === "insert") {
    if (!cell_type) throw new Error("cell_type is required when using edit_mode='insert'.");
    if (new_source === undefined)
      throw new Error("new_source is required when using edit_mode='insert'.");

    let insertIndex: number;
    if (cell_id === undefined && cell_number === undefined) {
      insertIndex = 0;
    } else {
      const idx = findCellIndex(notebook, cell_id, cell_number);
      insertIndex = Math.min(idx + 1, notebook.cells.length);
    }

    const newCell: NotebookCell = {
      cell_type,
      source: new_source.split("\n"),
      metadata: {},
      ...(cell_type === "code"
        ? { execution_count: null, outputs: [] }
        : {}),
    };
    notebook.cells.splice(insertIndex, 0, newCell);
  } else {
    // replace
    const idx = findCellIndex(notebook, cell_id, cell_number);
    if (new_source === undefined) {
      throw new Error("new_source is required when using edit_mode='replace'.");
    }
    const target = notebook.cells[idx]!;
    target.source = new_source.split("\n");
    if (target.cell_type === "code") {
      target.execution_count = null;
      target.outputs = [];
    }
    if (cell_type && cell_type !== target.cell_type) {
      target.cell_type = cell_type;
    }
  }

  const updated = JSON.stringify(notebook, null, 1);
  await writeFile(resolved, updated, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
    success: true as const,
    path: relative(cwd, resolved),
    edit_mode,
    cell_id,
    cell_number,
  };
}
