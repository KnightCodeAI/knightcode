import { exec } from "child_process";
import { useEffect, useState } from "react";
import { useTheme } from "../../providers/theme";
import {
  formatRootForDisplay,
  getExecutionRoot,
} from "../../lib/worktree-tools";

type Props = {
  sessionId?: string;
};

export function DiffDialogContent({ sessionId }: Props) {
  const { colors } = useTheme();
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rootLabel, setRootLabel] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const root = getExecutionRoot(sessionId).root;
    setRootLabel(formatRootForDisplay(root));
    exec("git diff", { cwd: root }, (error, stdout, stderr) => {
      setDiff(stdout || stderr || "");
      setLoading(false);
    });
  }, [sessionId]);

  if (loading) {
    return (
      <box padding={1}>
        <text fg="gray">Loading diff...</text>
      </box>
    );
  }

  if (!diff || !diff.trim()) {
    return (
      <box padding={1} flexDirection="column">
        {rootLabel && <text fg="gray">Worktree: {rootLabel}</text>}
        <text fg="gray">No changes found in the repository.</text>
      </box>
    );
  }

  const lines = diff.split("\n");

  return (
    <box flexDirection="column" width="100%">
      {rootLabel && <text fg="gray">Worktree: {rootLabel}</text>}
      <scrollbox height={15} width="100%">
        <box flexDirection="column" gap={0} width="100%">
          {lines.map((line, idx) => {
            let fg = "white";
            if (line.startsWith("+") && !line.startsWith("+++")) {
              fg = "green";
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              fg = "red";
            } else if (
              line.startsWith("@@") ||
              line.startsWith("diff") ||
              line.startsWith("index") ||
              line.startsWith("---") ||
              line.startsWith("+++")
            ) {
              fg = "yellow";
            } else {
              fg = "gray";
            }
            return (
              <text key={idx} fg={fg}>
                {line}
              </text>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}
