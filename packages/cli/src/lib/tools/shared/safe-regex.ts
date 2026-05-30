import safeRegex from "safe-regex";

export function isSafeRegex(pattern: string): boolean {
  return safeRegex(pattern);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateAndGetRegex(pattern: string, flags: string): RegExp {
  if (!isSafeRegex(pattern)) {
    return new RegExp(escapeRegExp(pattern), flags);
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return new RegExp(escapeRegExp(pattern), flags);
  }
}
