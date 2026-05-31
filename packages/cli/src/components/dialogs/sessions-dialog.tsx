import { useCallback, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useNavigate } from "react-router";
import { useDialog } from "../../providers/dialogs";
import { getStore } from "../../lib/store/client";
import { listSessions, type SessionRow } from "../../lib/store";
import { DialogSearchList } from "../dialog-search-list";

export const SessionsDialogContent = () => {
  const [sessions] = useState<SessionRow[]>(() =>
    listSessions(getStore(), process.cwd()),
  );
  const { close } = useDialog();
  const navigate = useNavigate();

  const handleSelect = useCallback(
    (session: SessionRow) => {
      close();
      navigate(`/sessions/${session.id}`);
    },
    [close, navigate],
  );

  return (
    <DialogSearchList
      items={sessions}
      onSelect={handleSelect}
      filterFn={(s, query) =>
        s.title.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(session, isSelected) => (
        <>
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {session.title}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            fg={isSelected ? "black" : undefined}
            attributes={TextAttributes.DIM}
          >
            {format(new Date(session.timeUpdated), "hh:mm a")}
          </text>
        </>
      )}
      getKey={(s) => s.id}
      placeholder="Search sessions"
      emptyText="No sessions in this directory"
    />
  );
};
