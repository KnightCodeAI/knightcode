import fs from "fs";
import { open, readFile, stat } from "fs/promises";
import readline from "readline";
import { Read, type KnightcodeTool } from "@repo/shared";
import {
  assertSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import { MAX_FILE_SIZE, DEFAULT_READ_LIMIT } from "../shared/constants";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "ico", "svg"];

export const tool: KnightcodeTool = Read;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { file_path, offset, limit } = Read.input_schema.parse(input);
  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, file_path);
  assertSafeProjectFile(resolved, cwd, "read");

  const stats = await stat(resolved);
  const fileSize = stats.size;

  const ext = file_path.split(".").pop()?.toLowerCase();
  if (ext && IMAGE_EXTENSIONS.includes(ext)) {
    const bytesToRead = Math.min(fileSize, MAX_FILE_SIZE);
    const buffer = Buffer.alloc(bytesToRead);
    const fh = await open(resolved, "r");
    try {
      await fh.read(buffer, 0, bytesToRead, 0);
    } finally {
      await fh.close();
    }
    const mimeType =
      ext === "svg"
        ? "image/svg+xml"
        : ext === "ico"
          ? "image/x-icon"
          : `image/${ext === "jpg" ? "jpeg" : ext}`;
    return {
      content: buffer.toString("base64"),
      isImage: true,
      mimeType,
      totalLength: fileSize,
      truncated: fileSize > MAX_FILE_SIZE,
    };
  }

  if (offset !== undefined || limit !== undefined) {
    const start = offset ?? 0;
    const count = limit ?? DEFAULT_READ_LIMIT;
    const lines: string[] = [];
    let lineCount = 0;

    const fileStream = fs.createReadStream(resolved, { encoding: "utf-8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (lineCount >= start && lineCount < start + count) {
        lines.push(line);
      }
      lineCount++;
    }

    const pastEof = start >= lineCount && lineCount > 0;
    return {
      content: lines.join("\n"),
      totalLines: lineCount,
      offset: start,
      linesReturned: lines.length,
      truncated: start + count < lineCount,
      pastEof,
    };
  }

  if (fileSize > MAX_FILE_SIZE) {
    const bytesToRead = Math.min(fileSize, MAX_FILE_SIZE * 2);
    const buffer = Buffer.alloc(bytesToRead);
    const fh = await open(resolved, "r");
    try {
      await fh.read(buffer, 0, bytesToRead, 0);
    } finally {
      await fh.close();
    }
    const text = buffer.toString("utf-8");
    return {
      content: text.slice(0, MAX_FILE_SIZE),
      truncated: true,
      totalLength: fileSize,
    };
  }

  const raw = await readFile(resolved, "utf-8");
  return { content: raw };
}
