import { SUPPORTED_CHAT_MODELS, findSupportedChatModel } from "@knightcode/shared";
import {
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
  ReasoningDialogContent,
} from "../dialogs";
import type { Command } from "./types";
import { apiClient } from "../../lib/api-client";

export const COMMANDS: Command[] = [
  {
    name: "agents",
    description: "Manage and switch AI agents",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Agent",
        children: (
          <AgentsDialogContent
            currentMode={ctx.mode}
            onSelectMode={ctx.setMode}
          />
        ),
      });
    },
  },
  {
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.toast.show({
        message: "Closing application...",
        variant: "info",
      });

      setTimeout(() => {
        ctx.exit();
      }, 500);
    },
  },
  {
    name: "login",
    description: "Sign in to your account",
    value: "/login",
    action: (ctx) => {
      ctx.toast.show({
        message: "Opening login flow...",
        variant: "success",
      });
    },
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
    action: (ctx) => {
      ctx.toast.show({
        message: "Logging out...",
        variant: "info",
      });
    },
  },
  {
    name: "models",
    description: "View and switch AI models",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: (
          <ModelsDialogContent
            models={SUPPORTED_CHAT_MODELS.map((m) => m.id)}
            currentModel={ctx.model}
            onSelectModel={ctx.setModel}
          />
        ),
      });
    },
  },
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.navigate("/");
    },
  },
  {
    name: "reasoning",
    description: "Set AI reasoning effort level",
    value: "/reasoning",
    action: (ctx) => {
      const modelDef = findSupportedChatModel(ctx.model);
      if (!modelDef?.supportsThinking) {
        ctx.toast.show({
          message: `Model ${ctx.model.replace(/:free$/, "")} does not support reasoning/thinking.`,
          variant: "error",
        });
        return;
      }

      ctx.dialog.open({
        title: "Select Reasoning Effort",
        children: (
          <ReasoningDialogContent
            currentEffort={ctx.reasoningEffort}
            onSelectEffort={async (level) => {
              ctx.setReasoningEffort(level);
              if (ctx.sessionId) {
                try {
                  const res = await apiClient.sessions[":id"].$patch({
                    param: { id: ctx.sessionId },
                    json: { reasoningEffort: level },
                  });
                  if (!res.ok) {
                    ctx.toast.show({
                      message: "Failed to persist reasoning effort on server",
                      variant: "error",
                    });
                  }
                } catch (err) {
                  ctx.toast.show({
                    message: "Error updating session reasoning effort",
                    variant: "error",
                  });
                }
              }
            }}
          />
        ),
      });
    },
  },
  {
    name: "sessions",
    description: "View and manage sessions",
    value: "/sessions",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Sessions",
        children: <SessionsDialogContent />,
      });
    },
  },
  {
    name: "theme",
    description: "Change application theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select theme",
        children: <ThemeDialogContent />,
      });
    },
  },
  {
    name: "upgrade",
    description: "Upgrade your subscription plan",
    value: "/upgrade",
    action: (ctx) => {
      ctx.toast.show({
        message: "Opening upgrade options...",
        variant: "success",
      });
    },
  },
  {
    name: "usage",
    description: "View current usage and limits",
    value: "/usage",
    action: (ctx) => {
      ctx.toast.show({
        message: "Fetching usage statistics...",
        variant: "info",
      });
    },
  },
];
