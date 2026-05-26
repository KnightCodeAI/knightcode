export interface DiffLine {
  type: "added" | "deleted" | "unchanged";
  content: string;
}

function splitLines(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}

export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  if (oldStr === "" && newStr === "") {
    return [{ type: "unchanged", content: "" }];
  }

  const oldLines = splitLines(oldStr);
  const newLines = splitLines(newStr);

  const dp: number[][] = Array(oldLines.length + 1)
    .fill(null)
    .map(() => Array(newLines.length + 1).fill(0));

  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const revDiff: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      revDiff.push({
        type: "unchanged",
        content: oldLines[i - 1]!,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      revDiff.push({
        type: "added",
        content: newLines[j - 1]!,
      });
      j--;
    } else {
      revDiff.push({
        type: "deleted",
        content: oldLines[i - 1]!,
      });
      i--;
    }
  }

  revDiff.reverse();
  return revDiff;
}
