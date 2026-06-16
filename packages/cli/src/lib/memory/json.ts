/**
 * Extract the first JSON array from a model response. Side models often wrap
 * arrays in prose or ```json fences; find the first `[` and scan forward to its
 * matching `]` (tracking nesting, and ignoring brackets inside string literals)
 * so trailing prose like `[1,2] see also [note]` still parses. Returns [] on
 * any failure.
 */
export function extractJsonArray(raw: string): unknown[] {
  const start = raw.indexOf("[");
  if (start === -1) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
