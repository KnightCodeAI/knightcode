import { readFile, writeFile } from "fs/promises";
import { relative } from "path";
import { MultiEdit, type KnightcodeTool } from "@knightcode/shared";
import {
  assertSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import {
  detectLineEnding,
  findActualString,
  preserveQuoteStyle,
  stripTrailingWhitespace,
} from "../shared/string-matching";
import { recordOriginalContent } from "../shared/session-snapshot";

export const tool: KnightcodeTool = MultiEdit;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
  const { file_path, edits } = MultiEdit.input_schema.parse(input);
  if (edits.length === 0) {
    throw new Error("edits array is empty");
  }

  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, file_path, true);
  assertSafeProjectFile(resolved, cwd, "modify");
  await recordOriginalContent(ctx.sessionId, resolved);

  const originalContent = await readFile(resolved, "utf-8");
  const originalEnding = detectLineEnding(originalContent);
  const isMarkdown = /\.(md|mdx)$/i.test(file_path);

  let working = originalContent;
  let totalReplacements = 0;
  const appliedEdits: { index: number; replacements: number }[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const { old_string, new_string, replace_all } = edit;

    if (old_string === "") {
      if (i === 0 && working.length === 0) {
        working = new_string;
        appliedEdits.push({ index: i, replacements: 1 });
        totalReplacements += 1;
        continue;
      }
      throw new Error(
        `Edit ${i}: old_string is empty but file is not empty. Use a non-empty old_string.`,
      );
    }

    const actualOldString = findActualString(working, old_string);
    if (!actualOldString) {
      throw new Error(
        `Edit ${i}: old_string not found in ${file_path}. The previous ${i} edits have been rolled back.`,
      );
    }

    const occurrences = working.split(actualOldString).length - 1;
    if (occurrences > 1 && !replace_all) {
      throw new Error(
        `Edit ${i}: old_string is ambiguous in current file state (${occurrences} matches). Either provide more context or use replace_all: true. The previous ${i} edits have been rolled back.`,
      );
    }

    let finalNewString = preserveQuoteStyle(old_string, actualOldString, new_string);
    finalNewString = stripTrailingWhitespace(finalNewString, isMarkdown);

    let next = replace_all
      ? working.replaceAll(actualOldString, finalNewString)
      : working.replace(actualOldString, finalNewString);

    if (finalNewString === "" && !actualOldString.endsWith("\n")) {
      const withTrailingNewline = actualOldString + "\n";
      if (working.includes(withTrailingNewline)) {
        next = replace_all
          ? working.replaceAll(withTrailingNewline, "")
          : working.replace(withTrailingNewline, "");
      }
    }

    working = next;
    const replacementsForThisEdit = replace_all ? occurrences : 1;
    totalReplacements += replacementsForThisEdit;
    appliedEdits.push({ index: i, replacements: replacementsForThisEdit });
  }

  if (originalEnding === "\r\n" && !working.includes("\r\n")) {
    working = working.replaceAll("\n", "\r\n");
  }

  await writeFile(resolved, working, "utf-8");
  return {
    success: true as const,
    path: relative(cwd, resolved),
    edits_applied: appliedEdits.length,
    total_replacements: totalReplacements,
  };
}
