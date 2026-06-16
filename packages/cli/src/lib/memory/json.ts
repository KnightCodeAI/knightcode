/**
 * Extract the first JSON array from a model response. Side models often wrap
 * arrays in prose or ```json fences; slice between the first `[` and its
 * matching last `]` and parse. Returns [] on any failure.
 */
export function extractJsonArray(raw: string): unknown[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
