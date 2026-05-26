import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useToast } from "../../providers/toast";
import { usePromptConfig } from "../../providers/prompt-config";
import {
  formatRootForDisplay,
  getExecutionRoot,
  getWorktreeStatus,
  getRepoRoot,
  type WorktreeRecord,
} from "../../lib/worktree-tools";

type Props = {
  sessionId?: string;
};

export function WorktreeDialogContent({ sessionId }: Props) {
  const [record, setRecord] = useState<WorktreeRecord | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const { worktreeDisabled, setWorktreeDisabled } = usePromptConfig();
  const toast = useToast();

  const loadStatus = () => {
    const executionRoot = getExecutionRoot(sessionId);
    setRoot(formatRootForDisplay(executionRoot.root));
    setIsolated(executionRoot.isolated);
    setReason(executionRoot.reason);
    setRecord(sessionId ? getWorktreeStatus(sessionId) : null);
  };

  useEffect(() => {
    loadStatus();
  }, [sessionId]);

  useKeyboard((key) => {
    if (key.name === "space") {
      key.preventDefault();
      const repoRoot = getRepoRoot();
      if (!repoRoot) {
        toast.show({
          variant: "error",
          message: "Not inside a git repository",
        });
        return;
      }
      const nextDisabled = !worktreeDisabled;
      setWorktreeDisabled(nextDisabled);

      toast.show({
        variant: "success",
        message: nextDisabled
          ? "Switched to Direct Workspace. Restart session to apply."
          : "Switched to Isolated Git Worktree. Restart session to apply.",
      });

      // Reload status immediately after modifying settings
      loadStatus();
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text fg={isolated ? "green" : "yellow"}>
        {isolated ? "Isolated git worktree active" : "Direct workspace mode"}
      </text>
      {root && <text>Execution root: {root}</text>}
      {record && <text>Branch: {record.branchName}</text>}
      {record && <text>Status: {record.status}</text>}
      {reason && <text fg="gray">Reason: {reason}</text>}

      <box flexDirection="row" gap={1} marginTop={1}>
        <text fg="gray">Configured target mode: </text>
        <text fg={worktreeDisabled ? "yellow" : "green"}>
          {worktreeDisabled
            ? "Direct Workspace (Claude style)"
            : "Isolated Git Worktree (Devin style)"}
        </text>
      </box>

      <text fg="gray" marginTop={1}>
        File, shell, and git tools run from this root for the current session.
      </text>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg="yellow">[Space] Toggle Isolation</text>
        <text fg="gray">[Esc] Close</text>
      </box>
    </box>
  );
}
