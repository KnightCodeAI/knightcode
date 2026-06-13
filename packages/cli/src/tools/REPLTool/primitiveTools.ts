import type { Tool } from '../../Tool.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'
import { GlobTool } from '../GlobTool/GlobTool.js'
import { GrepTool } from '../GrepTool/GrepTool.js'

let _primitiveTools: readonly Tool[] | undefined

/**
 * Primitive tools hidden from direct model use when REPL mode is on
 * (REPL_ONLY_TOOLS) but still accessible inside the REPL VM context.
 * Exported so display-side code (collapseReadSearch, renderers) can
 * classify/render virtual messages for these tools even when they're
 * absent from the filtered execution tools list.
 *
 * Lazy getter — the import chain collapseReadSearch.ts → primitiveTools.ts
 * → FileReadTool.tsx → ... loops back through the tool registry, so a
 * top-level const hits "Cannot access before initialization". Deferring
 * to call time avoids the TDZ.
 *
 * Scoped to the tools this build actually ships; the shell and notebook
 * primitives are not part of the registry here.
 */
export function getReplPrimitiveTools(): readonly Tool[] {
  return (_primitiveTools ??= [
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
  ])
}
