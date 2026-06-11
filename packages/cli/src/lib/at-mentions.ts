import { readdir, readFile, stat } from "fs/promises";
import {
  isSafeProjectFile,
  resolveInsideRoot,
} from "./tools/shared/path-resolution";

const MAX_DIR_ENTRIES = 1000;
const MAX_FILE_CHARS = 40_000;

/**
 * Extract paths mentioned with the @ symbol, ported from claude-code's
 * extractAtMentionedFiles (attachments.ts). Mentions must be preceded by
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
      const entries = await readdir(resolved, { withFileTypes: true });
      const names = entries
        .slice(0, MAX_DIR_ENTRIES)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      if (entries.length > MAX_DIR_ENTRIES) {
        names.push(`… and ${entries.length - MAX_DIR_ENTRIES} more entries`);
      }
      return `Contents of directory @${mention}:\n${names.join("\n")}`;
    }

    let content = await readFile(resolved, "utf-8");
    if (content.length > MAX_FILE_CHARS) {
      content = `${content.slice(0, MAX_FILE_CHARS)}\n… (truncated; read the file for the rest)`;
    }
    return `Contents of file @${mention}:\n${content}`;
  } catch {
    // Missing path, unreadable file, outside the project root — the mention
    // was probably not a path at all. Silently skip, like claude-code.
    return null;
  }
}

/**
 * Resolve every @-mentioned path in a prompt and return one system-reminder
 * block with their contents (directory listings / file bodies), or null when
 * nothing resolved. claude-code expands mentions the same way at submit time
 * (processAtMentionedFiles) so the model never searches for the literal
 * "@path" text.
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
