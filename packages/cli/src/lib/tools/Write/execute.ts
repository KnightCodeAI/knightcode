import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative } from "path";
import { Write, type KnightcodeTool } from "@repo/shared";
import {
  assertSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import { detectLineEnding } from "../shared/string-matching";
import { recordOriginalContent } from "../shared/session-snapshot";
import { assertWritable, recordWrite } from "../shared/file-ledger";

export const tool: KnightcodeTool = Write;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string; sessionId: string },
): Promise<unknown> {
  const { file_path, content } = Write.input_schema.parse(input);
  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, file_path, true);
  assertSafeProjectFile(resolved, cwd, "modify");
  assertWritable(ctx.sessionId, resolved, { allowCreate: true });
  await recordOriginalContent(ctx.sessionId, resolved);
  await mkdir(dirname(resolved), { recursive: true });

  let contentToWrite = content;
  try {
    const existing = await readFile(resolved, "utf-8");
    if (detectLineEnding(existing) === "\r\n") {
      contentToWrite = content
        .replaceAll("\n", "\r\n")
        .replaceAll("\r\r\n", "\r\n");
    }
  } catch {
    // file doesn't exist yet
  }

  await writeFile(resolved, contentToWrite, "utf-8");
  recordWrite(ctx.sessionId, resolved);
  return {
    success: true as const,
    path: relative(cwd, resolved),
    bytesWritten: Buffer.byteLength(contentToWrite, "utf-8"),
  };
}
