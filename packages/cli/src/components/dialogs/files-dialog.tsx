import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { getSessionModifiedFiles } from "../../lib/tools";
import { useTheme } from "../../providers/theme";

type Props = {
  sessionId: string;
};

export function FilesDialogContent({ sessionId }: Props) {
  const { colors } = useTheme();
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    setFiles(getSessionModifiedFiles(sessionId));
  }, [sessionId]);

  if (files.length === 0) {
    return (
      <box flexDirection="column" paddingY={1}>
        <text attributes={TextAttributes.DIM}>
          No files modified in this session.
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.DIM}>
        {files.length} file{files.length !== 1 ? "s" : ""} modified this
        session:
      </text>
      {files.map((file) => (
        <box key={file} flexDirection="row" gap={1} paddingX={1}>
          <text fg={colors.success}>•</text>
          <text>{file}</text>
        </box>
      ))}
    </box>
  );
}
