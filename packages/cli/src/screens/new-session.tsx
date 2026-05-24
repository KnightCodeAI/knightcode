import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";
import {
  modeSchema,
  findSupportedChatModel,
  type ModeType,
  type SupportedChatModelId,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import { UserMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useToast } from "../providers/toast";

const newSessionStateSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  model: z.string().refine((v) => !!findSupportedChatModel(v), "Unsupported model"),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]).optional(),
});

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const hasStartedRef = useRef(false);

  const state = useMemo(() => {
    const parsed = newSessionStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  // Guard: if navigated here directly without state, go home
  useEffect(() => {
    if (!state) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  // Create the session on mount — this screen exists to do this
  useEffect(() => {
    if (!state || hasStartedRef.current) return;

    hasStartedRef.current = true;

    let ignore = false;
    const createSession = async () => {
      try {
        const res = await apiClient.sessions.$post({
          json: {
            title: state.message.slice(0, 100),
            reasoningEffort: state.reasoningEffort,
          },
        });

        if (ignore) return;
        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        navigate(`/sessions/${session.id}`, {
          replace: true,
          state: {
            session,
            initialPrompt: {
              message: state.message,
              mode: state.mode,
              model: state.model,
            },
          },
        });
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", { replace: true });
      }
    };

    createSession();
    return () => {
      ignore = true;
    };
  }, [state, navigate, toast]);

  if (!state) return null;

  return (
    <SessionShell onSubmit={() => {}} inputDisabled loading>
      <UserMessage message={state.message} mode={state.mode} />
    </SessionShell>
  );
}
