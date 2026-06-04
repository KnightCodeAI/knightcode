export type WordSegment = { text: string; changed: boolean };

/** Split into alternating word / whitespace runs so spacing is preserved. */
function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

/**
 * Word-level diff of a removed/added line pair (the reference TUI's intra-line
 * highlight). Returns each side's tokens flagged as changed (not in the LCS)
 * or common, so the renderer can emphasise just the words that differ.
 */
export function wordDiff(
  oldLine: string,
  newLine: string,
): { removed: WordSegment[]; added: WordSegment[] } {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);

  const dp: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const removed: WordSegment[] = [];
  const added: WordSegment[] = [];
  let i = a.length;
  let j = b.length;
  // Walk backwards; common tokens (in LCS) are unchanged, the rest are changed.
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      removed.push({ text: a[i - 1]!, changed: false });
      added.push({ text: b[j - 1]!, changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      added.push({ text: b[j - 1]!, changed: true });
      j--;
    } else {
      removed.push({ text: a[i - 1]!, changed: true });
      i--;
    }
  }

  removed.reverse();
  added.reverse();
  return { removed: coalesce(removed), added: coalesce(added) };
}

/** Merge adjacent segments of the same kind so we emit fewer spans. */
function coalesce(segs: WordSegment[]): WordSegment[] {
  const out: WordSegment[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && last.changed === seg.changed) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}
