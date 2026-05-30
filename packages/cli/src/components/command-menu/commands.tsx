import {
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
  ReasoningDialogContent,
  MemoryDialogContent,
  AllowDialogContent,
  RenameDialogContent,
  FilesDialogContent,
  HelpDialogContent,
  CostDialogContent,
  ClearDialogContent,
  StatusDialogContent,
  DoctorDialogContent,
  HooksDialogContent,
  RewindDialogContent,
  StatsDialogContent,
} from "../dialogs";
import { undoSessionChanges } from "../../lib/tools";
import {
  SUPPORTED_CHAT_MODELS,
  findSupportedChatModel,
} from "@knightcode/shared";
import type { Command } from "./types";
import { apiClient } from "../../lib/api-client";
import { performLogin } from "../../lib/auth/oauth";
import { clearAuth } from "../../lib/auth/auth";
import { openBillingPortal, openUpgradeCheckout } from "../../lib/upgrade";
import fs from "fs";
import path from "path";
import { copyToClipboard } from "../../lib/clipboard";
import open from "open";
import {
  REVIEW_PROMPT,
  SECURITY_REVIEW_PROMPT,
  COMMIT_PROMPT,
  COMMIT_PUSH_PR_PROMPT,
  INIT_PROMPT,
} from "../../lib/prompts";

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
        message: "Logged out successfully",
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
    description:
      "Initialize KNIGHTCODE.md, skills, and hooks with codebase analysis",
    value: "/init",
    action: (ctx) => {
      if (!ctx.submitCommand) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      // Deterministic guard before sending the model anywhere near the file —
      // a soft prompt-level Phase-1 question is not enough to prevent an
      // overwrite of an existing memory file with custom user rules.
      const memoryPath = path.join(process.cwd(), "KNIGHTCODE.md");
      if (fs.existsSync(memoryPath)) {
        ctx.toast.show({
          variant: "error",
          message: "KNIGHTCODE.md already exists — delete or rename it first",
        });
        return;
      }
      ctx.submitCommand(INIT_PROMPT, "Initialising knightcode.md…");
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
    argumentHint: "<optional custom summarization instructions>",
    action: async (ctx) => {
      if (ctx.compact) {
        try {
          await ctx.compact();
          // compactHistory handles all success/info toasts internally
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
  {
    name: "rename",
    description: "Rename the current session",
    value: "/rename",
    action: (ctx) => {
      if (!ctx.sessionId) {
        ctx.toast.show({
          variant: "error",
          message: "No active session to rename",
        });
        return;
      }
      ctx.dialog.open({
        title: "Rename Session",
        children: <RenameDialogContent sessionId={ctx.sessionId} />,
      });
    },
  },
  {
    name: "files",
    description: "Show files modified in this session",
    value: "/files",
    action: (ctx) => {
      if (!ctx.sessionId) {
        ctx.toast.show({ variant: "error", message: "No active session" });
        return;
      }
      ctx.dialog.open({
        title: "Modified Files",
        children: <FilesDialogContent sessionId={ctx.sessionId} />,
      });
    },
  },

  {
    name: "copy",
    description: "Copy the last assistant message to clipboard",
    value: "/copy",
    action: (ctx) => {
      const lastAssistant = [...(ctx.messages ?? [])]
        .reverse()
        .find((m) => m.role === "assistant");

      if (!lastAssistant) {
        ctx.toast.show({
          variant: "error",
          message: "No assistant message to copy",
        });
        return;
      }

      const text = lastAssistant.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("");

      if (!text.trim()) {
        ctx.toast.show({
          variant: "error",
          message: "Last message has no text",
        });
        return;
      }

      const ok = copyToClipboard(text);
      ctx.toast.show(
        ok
          ? { variant: "success", message: "Copied to clipboard" }
          : {
              variant: "error",
              message: "Clipboard unavailable on this system",
            },
      );
    },
  },
  {
    name: "cost",
    description: "Show session token usage and cost",
    value: "/cost",
    action: (ctx) => {
      if (!ctx.tokenStats) {
        ctx.toast.show({ variant: "error", message: "No usage data yet" });
        return;
      }
      ctx.dialog.open({
        title: "Session Cost",
        children: (
          <CostDialogContent tokenStats={ctx.tokenStats} model={ctx.model} />
        ),
      });
    },
  },
  {
    name: "clear",
    description: "Clear all messages in this conversation",
    value: "/clear",
    action: (ctx) => {
      if (!ctx.clearMessages) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      ctx.dialog.open({
        title: "Clear Conversation",
        children: <ClearDialogContent clearMessages={ctx.clearMessages} />,
      });
    },
  },
  {
    name: "status",
    description: "Show current session info and stats",
    value: "/status",
    action: (ctx) => {
      if (!ctx.sessionId) {
        ctx.toast.show({ variant: "error", message: "No active session" });
        return;
      }
      ctx.dialog.open({
        title: "Session Status",
        children: (
          <StatusDialogContent
            sessionId={ctx.sessionId}
            model={ctx.model}
            mode={ctx.mode}
            messages={ctx.messages ?? []}
            tokenStats={ctx.tokenStats}
          />
        ),
      });
    },
  },
  {
    name: "doctor",
    description: "Run diagnostics — auth, server, git",
    value: "/doctor",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Diagnostics",
        children: <DoctorDialogContent />,
      });
    },
  },
  {
    name: "help",
    description: "List all available slash commands",
    value: "/help",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Commands",
        children: <HelpDialogContent />,
      });
    },
  },

  {
    name: "hooks",
    description: "Manage PreToolUse / PostToolUse lifecycle hooks",
    value: "/hooks",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Hooks",
        children: <HooksDialogContent />,
      });
    },
  },
  {
    name: "rewind",
    description: "Remove the last N turns from this conversation",
    value: "/rewind",
    action: (ctx) => {
      if (!ctx.rewindMessages) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      const turns = Math.floor(
        (ctx.messages ?? []).filter((m) => m.role === "user").length,
      );
      if (turns === 0) {
        ctx.toast.show({ variant: "info", message: "Nothing to rewind" });
        return;
      }
      ctx.dialog.open({
        title: "Rewind",
        children: (
          <RewindDialogContent
            rewindMessages={ctx.rewindMessages}
            maxTurns={turns}
          />
        ),
      });
    },
  },
  {
    name: "branch",
    description: "Fork this conversation into a new session",
    value: "/branch",
    action: async (ctx) => {
      if (!ctx.messages || ctx.messages.length === 0) {
        ctx.toast.show({ variant: "error", message: "Nothing to branch from" });
        return;
      }
      ctx.toast.show({ message: "Forking session…" });
      try {
        const createRes = await apiClient.sessions.$post({
          json: { title: "Branch" },
        });
        if (!createRes.ok) {
          ctx.toast.show({
            variant: "error",
            message: "Failed to create branch session",
          });
          return;
        }
        const newSession = await createRes.json();

        type ServerMessage = {
          id: string;
          role: "user" | "assistant" | "system" | "data";
          content?: string;
          parts?: unknown[];
          metadata?: Record<string, unknown>;
        };
        const patchRes = await apiClient.sessions[":id"].$patch({
          param: { id: newSession.id },
          json: {
            messages: (ctx.messages ?? []) as unknown as ServerMessage[],
            title: "Branch",
          },
        });
        if (!patchRes.ok) {
          ctx.toast.show({
            variant: "error",
            message: "Branch created but failed to copy messages",
          });
          return;
        }

        ctx.toast.show({
          variant: "success",
          message: "Session forked — navigating…",
        });
        setTimeout(() => {
          ctx.navigate(`/sessions/${newSession.id}`);
        }, 400);
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: `Branch failed: ${(err as Error).message}`,
        });
      }
    },
  },
  {
    name: "review",
    description: "Review a pull request (uses gh CLI)",
    value: "/review",
    action: (ctx) => {
      if (!ctx.submitMessage) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      ctx.submitMessage(REVIEW_PROMPT);
    },
  },
  {
    name: "security-review",
    description: "Security audit of a PR or uncommitted changes",
    value: "/security-review",
    action: (ctx) => {
      if (!ctx.submitMessage) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      ctx.submitMessage(SECURITY_REVIEW_PROMPT);
    },
  },
  {
    name: "stats",
    description: "Show aggregate token usage across all sessions",
    value: "/stats",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Usage Statistics",
        children: <StatsDialogContent />,
      });
    },
  },
  {
    name: "feedback",
    description: "Open GitHub issues to report a bug or request a feature",
    value: "/feedback",
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening GitHub issues…" });
      try {
        await open("https://github.com/Raghav1428/knightcode/issues/new");
        ctx.toast.show({ variant: "success", message: "Opened in browser" });
      } catch {
        ctx.toast.show({ variant: "error", message: "Could not open browser" });
      }
    },
  },
  {
    name: "export",
    description: "Export conversation to a markdown file",
    value: "/export",
    action: (ctx) => {
      const messages = ctx.messages ?? [];
      if (messages.length === 0) {
        ctx.toast.show({ variant: "error", message: "Nothing to export yet" });
        return;
      }

      try {
        const lines: string[] = [
          `# Knightcode Export`,
          ``,
          `Exported: ${new Date().toLocaleString()}`,
          ``,
          `---`,
          ``,
        ];

        for (const msg of messages) {
          if (!msg?.parts) continue;
          const text = msg.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("");
          if (!text.trim()) continue;

          if (msg.role === "user") {
            lines.push(`## You`, ``, text, ``);
          } else if (msg.role === "assistant") {
            lines.push(`## Assistant`, ``, text, ``);
          }
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        // Sanitize: strip any path separators from the generated filename
        const filename = `knightcode-export-${dateStr}.md`.replace(
          /[/\\]/g,
          "-",
        );
        const exportDir = process.cwd();
        const outputPath = path.resolve(exportDir, filename);

        // Guard against path traversal — use sep suffix so sibling dirs don't pass startsWith
        if (!outputPath.startsWith(exportDir + path.sep)) {
          throw new Error("Export path is outside working directory");
        }

        fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");

        ctx.toast.show({
          variant: "success",
          message: `Exported to ./${filename}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.toast.show({
          variant: "error",
          message:
            msg.includes("EACCES") || msg.includes("EPERM")
              ? `Export failed: no write permission in ${process.cwd()}`
              : msg.includes("ENOSPC")
                ? "Export failed: disk full"
                : `Export failed: ${msg}`,
        });
      }
    },
  },
  {
    name: "commit",
    description: "Commit staged changes with a style-matched message",
    value: "/commit",
    action(ctx) {
      if (!ctx.submitMessage) {
        ctx.toast.show({
          variant: "error",
          message: "Not available in this context",
        });
        return;
      }
      ctx.submitMessage(COMMIT_PROMPT);
    },
  },
  {
    name: "commit-push-pr",
    description: "Commit, push, and open a pull request via gh CLI",
    value: "/commit-push-pr",
    action(ctx) {
      if (!ctx.submitMessage) {
        ctx.toast.show({
          variant: "error",
          message: "Not available in this context",
        });
        return;
      }
      ctx.submitMessage(COMMIT_PUSH_PR_PROMPT);
    },
  },
];
