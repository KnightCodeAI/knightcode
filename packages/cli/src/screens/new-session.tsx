import { useLocation } from "react-router";
import { useNavigate } from "react-router";
import { useTheme } from "../providers/theme";
import { useEffect } from "react";
import { SessionShell } from "../components/session-shell";
import { BotMessage, ErrorMessage, UserMessage } from "../components/messages";

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { colors } = useTheme();

  const state = location.state as { message?: string } | null;

  useEffect(() => {
    if (!state?.message) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);

  if (!state?.message) return null;

  return (
    <SessionShell onSubmit={() => {}} inputDisabled loading>
      <UserMessage message={state.message} />
      <BotMessage content="This is a simple bot message" model="opus-4-6" />
      <ErrorMessage message="An error occured" />
    </SessionShell>
  );
}
