import { open, opendir, stat } from "fs/promises";
import {
  isSafeProjectFile,
  resolveInsideRoot,
} from "./tools/shared/path-resolution";

const MAX_DIR_ENTRIES = 1000;
const MAX_FILE_CHARS = 40_000;
// UTF-8 encodes at most 4 bytes per code point, so reading this many bytes is
// always enough to recover MAX_FILE_CHARS characters — without slurping a
// multi-gigabyte file into memory just to throw most of it away.
const MAX_FILE_BYTES = MAX_FILE_CHARS * 4;

/**
 * Extract paths mentioned with the @ symbol. Mentions must be preceded by
 * start-of-string or whitespace so emails (a@b.com) never match. Quoted
 * mentions (@"my file.txt") support paths with spaces.
 */
export function extractAtMentions(text: string): string[] {
  const quotedAtMentionRegex = /(^|\s)@"([^"]+)"/g;
  const regularAtMentionRegex = /(^|\s)@([^\s]+)\b/g;

  const mentions: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = quotedAtMentionRegex.exec(text)) !== null) {
    if (match[2]) mentions.push(match[2]);
  }

  const regularMatches = text.match(regularAtMentionRegex) ?? [];
  for (const m of regularMatches) {
    const path = m.slice(m.indexOf("@") + 1);
    // Quoted mentions were already captured above.
    if (!path.startsWith('"')) mentions.push(path);
  }

  return [...new Set(mentions)];
}

async function describeMention(
  mention: string,
  cwd: string,
): Promise<string | null> {
  try {
    const { resolved } = resolveInsideRoot(cwd, mention);
    if (!isSafeProjectFile(resolved, cwd)) return null;

    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      // Stream entries and stop once we have enough — a directory with 100k
      // files never materializes a 100k-element Dirent array in memory. The
      // iterator closes the handle when we break.
      const names: string[] = [];
      let more = false;
      for await (const entry of await opendir(resolved)) {
        if (names.length >= MAX_DIR_ENTRIES) {
          more = true;
          break;
        }
        names.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
      }
      if (more) names.push(`… and more entries (showing first ${MAX_DIR_ENTRIES})`);
      return `Contents of directory @${mention}:\n${names.join("\n")}`;
    }

    // Read at most MAX_FILE_BYTES rather than the whole file, so mentioning a
    // huge file can't spike memory or stall submission.
    const readLen = Math.min(stats.size, MAX_FILE_BYTES);
    const handle = await open(resolved, "r");
    let raw: string;
    try {
      const buf = Buffer.alloc(readLen);
      // A single read() can return fewer bytes than requested (a short read),
      // so loop until the buffer is filled or we hit EOF — otherwise part of
      // the file would be dropped with no truncation marker.
      let offset = 0;
      while (offset < readLen) {
        const { bytesRead } = await handle.read(
          buf,
          offset,
          readLen - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      raw = buf.subarray(0, offset).toString("utf-8");
    } finally {
      await handle.close();
    }
    const truncated = stats.size > readLen || raw.length > MAX_FILE_CHARS;
    const content = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
    return `Contents of file @${mention}:\n${content}${
      truncated ? "\n… (truncated; read the file for the rest)" : ""
    }`;
  } catch {
    // Missing path, unreadable file, outside the project root — the mention
    // was probably not a path at all. Silently skip.
    return null;
  }
}

/**
 * Resolve every @-mentioned path in a prompt and return one system-reminder
 * block with their contents (directory listings / file bodies), or null when
 * nothing resolved. Expanding mentions at submit time means the model never
 * searches for the literal "@path" text.
 */
export async function expandAtMentions(
  text: string,
  cwd: string,
): Promise<string | null> {
  const mentions = extractAtMentions(text);
  if (mentions.length === 0) return null;

  const sections = (
    await Promise.all(mentions.map((m) => describeMention(m, cwd)))
  ).filter((s): s is string => s !== null);
  if (sections.length === 0) return null;

  return `<system-reminder>\nThe user's message references these paths with @. Their contents are included below — use them directly instead of searching for the literal "@" text.\n\n${sections.join("\n\n")}\n</system-reminder>`;
}
