import {
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
  ReasoningDialogContent,
  MemoryDialogContent,
  DiffDialogContent,
  AllowDialogContent,
  WorktreeDialogContent,
} from "../dialogs";
import { undoSessionChanges } from "../../lib/local-tools";
import {
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
} from "@knightcode/shared";
import type { Command } from "./types";
import { apiClient } from "../../lib/api-client";
import { performLogin } from "../../lib/oauth";
import { clearAuth } from "../../lib/auth";
import { openBillingPortal, openUpgradeCheckout } from "../../lib/upgrade";
import fs from "fs";
import path from "path";
import { detectProjectStackSync } from "../../lib/project-detection";

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
    name: "allow",
    description: "Manage allowed commands (for automatic execution)",
    value: "/allow",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Allowed Commands",
        children: <AllowDialogContent />,
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
    action: async (ctx) => {
      ctx.toast.show({
        message: "Opening browser to sign in...",
      });
      try {
        await performLogin();
        ctx.toast.show({ variant: "success", message: "Sign in successful" });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sign in failed";
        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
    action: (ctx) => {
      clearAuth();
      ctx.toast.show({
        message: "Logged out successfull",
        variant: "success",
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
    action: async (ctx) => {
      ctx.toast.show({
        message: "Opening upgrade options...",
      });
      try {
        await openUpgradeCheckout();
        ctx.toast.show({
          message: "Checkout open in browser",
          variant: "success",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to open checkout";
        ctx.toast.show({ message, variant: "error" });
      }
    },
  },
  {
    name: "usage",
    description: "View current usage and limits",
    value: "/usage",
    action: async (ctx) => {
      ctx.toast.show({
        message: "Opening usage portal...",
      });
      try {
        await openBillingPortal();
        ctx.toast.show({
          message: "Billing portal opened in browser",
          variant: "success",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to open billing portal";
        ctx.toast.show({ message, variant: "error" });
      }
    },
  },
  {
    name: "init",
    description: "Initialize KNIGHTCODE.md project memory",
    value: "/init",
    action: (ctx) => {
      const localDir = process.cwd();
      const localPath = path.join(localDir, "KNIGHTCODE.md");

      if (fs.existsSync(localPath)) {
        ctx.toast.show({
          variant: "info",
          message: "KNIGHTCODE.md already exists in this project",
        });
        return;
      }

      const stack = detectProjectStackSync();
      const content = `# Project Memory: KnightCode Guidelines

## Tech Stack
- Frameworks: ${stack.frameworks.length > 0 ? stack.frameworks.join(", ") : "None detected"}
- Package Manager: ${stack.packageManager}
- TypeScript: ${stack.isTypeScript ? "Yes" : "No"}

## Project Rules
1. Maintain existing style conventions.
2. Run relevant tests before declaring a task finished.
3. Batch tools where possible.
`;
      try {
        fs.writeFileSync(localPath, content, "utf-8");
        ctx.toast.show({
          variant: "success",
          message: "Created KNIGHTCODE.md project memory template!",
        });
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: `Failed to create KNIGHTCODE.md: ${(err as Error).message}`,
        });
      }
    },
  },
  {
    name: "memory",
    description: "Write guidelines to KNIGHTCODE.md project memory",
    value: "/memory",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Project Guidelines",
        children: <MemoryDialogContent />,
      });
    },
  },
  {
    name: "diff",
    description: "Show repository diff of uncommitted changes",
    value: "/diff",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Repository Diff",
        children: <DiffDialogContent sessionId={ctx.sessionId} />,
      });
    },
  },
  {
    name: "worktree",
    description: "Show current session worktree isolation status",
    value: "/worktree",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Worktree",
        children: <WorktreeDialogContent sessionId={ctx.sessionId} />,
      });
    },
  },
  {
    name: "undo",
    description: "Undo all file changes made in this session",
    value: "/undo",
    action: async (ctx) => {
      try {
        const sessionId = ctx.sessionId ?? "default";
        const { revertedFiles, failedFiles } =
          await undoSessionChanges(sessionId);
        if (revertedFiles.length === 0 && failedFiles.length === 0) {
          ctx.toast.show({
            variant: "info",
            message: "No files modified in this session to revert.",
          });
        } else if (failedFiles.length > 0) {
          ctx.toast.show({
            variant: "error",
            message: `Failed to revert: ${failedFiles.join(", ")}. Reverted: ${revertedFiles.join(", ")}`,
          });
        } else {
          ctx.toast.show({
            variant: "success",
            message: `Reverted ${revertedFiles.length} file(s) modified in this session: ${revertedFiles.join(", ")}`,
          });
        }
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: `Failed to revert: ${(err as Error).message}`,
        });
      }
    },
  },
  {
    name: "compact",
    description: "Compact chat history to free up context",
    value: "/compact",
    action: async (ctx) => {
      if (ctx.compact) {
        try {
          await ctx.compact();
          ctx.toast.show({
            variant: "success",
            message: "Chat history compacted successfully.",
          });
        } catch (err) {
          ctx.toast.show({
            variant: "error",
            message: `Compaction failed: ${(err as Error).message}`,
          });
        }
      } else {
        ctx.toast.show({
          variant: "error",
          message: "Compaction is not available in this context.",
        });
      }
    },
  },
];
