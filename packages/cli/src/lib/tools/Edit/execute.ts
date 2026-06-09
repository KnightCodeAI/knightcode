import { readFile, writeFile } from "fs/promises";
import { relative } from "path";
import { Edit, type KnightcodeTool } from "@repo/shared";
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

export const tool: KnightcodeTool = Edit;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
  const { file_path, old_string, new_string, replace_all } =
    Edit.input_schema.parse(input);
  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, file_path, true);
  assertSafeProjectFile(resolved, cwd, "modify");
  await recordOriginalContent(ctx.sessionId, resolved);
  const content = await readFile(resolved, "utf-8");

  if (old_string === "") {
    if (content.length > 0) {
      throw new Error(
        "old_string is empty but file is not empty. Use a non-empty old_string to replace specific text, or use Write to overwrite the entire file.",
      );
    }
    await writeFile(resolved, new_string, "utf-8");
    return {
      success: true as const,
      path: relative(cwd, resolved),
      replacements: 1,
    };
  }

  const actualOldString = findActualString(content, old_string);
  if (!actualOldString) {
    throw new Error(
      `String not found in file. The old_string you provided does not match any text in ${file_path}. Ensure you've read the file first and that the text matches exactly, including whitespace, indentation, and quote characters.`,
    );
  }

  const occurrences = content.split(actualOldString).length - 1;
  if (occurrences > 1 && !replace_all) {
    throw new Error(
      `old_string is ambiguous; found ${occurrences} matches. Either include more surrounding context to make it unique, or use replace_all: true to replace all occurrences.`,
    );
  }

  const isMarkdown = /\.(md|mdx)$/i.test(file_path);
  let finalNewString = preserveQuoteStyle(old_string, actualOldString, new_string);
  finalNewString = stripTrailingWhitespace(finalNewString, isMarkdown);

  let updated = replace_all
    ? content.replaceAll(actualOldString, finalNewString)
    : content.replace(actualOldString, finalNewString);

  if (finalNewString === "" && !actualOldString.endsWith("\n")) {
    const withTrailingNewline = actualOldString + "\n";
    if (content.includes(withTrailingNewline)) {
      updated = replace_all
        ? content.replaceAll(withTrailingNewline, "")
        : content.replace(withTrailingNewline, "");
    }
  }

  const originalEnding = detectLineEnding(content);
  if (originalEnding === "\r\n" && !updated.includes("\r\n")) {
    updated = updated.replaceAll("\n", "\r\n");
  }

  await writeFile(resolved, updated, "utf-8");
  return {
    success: true as const,
    path: relative(cwd, resolved),
    replacements: replace_all ? occurrences : 1,
  };
}
