import { spawn, spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "Stop";

export type HookCommand = {
  type: "command";
  command: string;
  timeout?: number; // seconds
  async?: boolean; // run without blocking
};

export type HookMatcher = {
  matcher?: string; // tool name, "*" for all, or pipe-separated list "bash|python"
  hooks: HookCommand[];
};

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;

// Settings load/save live in ./settings (shared with the Config tool).
import { loadSettings, saveSettings } from "./settings";

// ---------------------------------------------------------------------------
// Hook output — what a subprocess can write to stdout
// ---------------------------------------------------------------------------

export type HookOutput = {
  // PreToolUse: "block" stops the tool; "approve" lets it through
  decision?: "approve" | "block";
  reason?: string;
  // Stop/UserPromptSubmit: false tells the AI not to continue
  continue?: boolean;
  stopReason?: string;
  // Any event: plain text appended to context
  systemMessage?: string;
  // Hide stdout from display
  suppressOutput?: boolean;
};

export function loadHooks(): HooksConfig {
  return loadSettings().hooks ?? {};
}

export function saveHooks(config: HooksConfig): void {
  const settings = loadSettings();
  settings.hooks = config;
  saveSettings(settings);
}

export function addHook(
  event: HookEvent,
  matcher: string,
  command: string,
): void {
  const config = loadHooks();
  if (!config[event]) config[event] = [];
  const group = config[event]!.find((m) => (m.matcher ?? "*") === matcher);
  if (group) {
    group.hooks.push({ type: "command", command });
  } else {
    config[event]!.push({ matcher, hooks: [{ type: "command", command }] });
  }
  saveHooks(config);
}

export function removeHook(
  event: HookEvent,
  matcherIndex: number,
  hookIndex: number,
): void {
  const config = loadHooks();
  const matchers = config[event];
  if (!matchers) return;
  const group = matchers[matcherIndex];
  if (!group) return;
  group.hooks.splice(hookIndex, 1);
  if (group.hooks.length === 0) matchers.splice(matcherIndex, 1);
  if (matchers.length === 0) delete config[event];
  saveHooks(config);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesMatcher(
  toolName: string,
  matcher: string | undefined,
): boolean {
  if (!matcher || matcher === "*") return true;
  return matcher
    .split("|")
    .some((m) => m.trim().toLowerCase() === toolName.toLowerCase());
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type BaseInput = {
  hook_event_name: HookEvent;
  session_id: string;
  cwd: string;
};

type PreToolUseInput = BaseInput & {
  tool_name: string;
  tool_input: unknown;
};

type PostToolUseInput = BaseInput & {
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
};

type UserPromptSubmitInput = BaseInput & {
  prompt: string;
};

type StopInput = BaseInput & {
  stop_hook_active: boolean;
};

type HookInput =
  | PreToolUseInput
  | PostToolUseInput
  | UserPromptSubmitInput
  | StopInput;

// ---------------------------------------------------------------------------
// Async execution — uses spawn so the event loop remains unblocked
// ---------------------------------------------------------------------------

function buildEnv(input: HookInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KNIGHTCODE_HOOK_EVENT: input.hook_event_name,
    KNIGHTCODE_SESSION_ID: input.session_id,
    KNIGHTCODE_CWD: input.cwd,
  };
  if ("tool_name" in input) {
    env.KNIGHTCODE_TOOL_NAME = (input as PreToolUseInput).tool_name;
  }
  return env;
}

async function execHook(
  hook: HookCommand,
  input: HookInput,
): Promise<HookOutput | null> {
  const timeoutMs = (hook.timeout ?? 60) * 1000;
  const inputJson = JSON.stringify(input);
  const env = buildEnv(input);

  return new Promise<HookOutput | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(hook.command, {
        shell: true,
        env,
        stdio: ["pipe", "pipe", "ignore"],
        detached: process.platform !== "win32",
      });
    } catch {
      resolve(null);
      return;
    }

    let stdout = "";
    let settled = false;

    const done = (result: HookOutput | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      const pid = child.pid;
      // Skip the kill entirely if spawn never produced a pid — process.kill(NaN)
      // raises a TypeError that the surrounding catch would swallow, leaving
      // the runaway hook child alive past the timeout.
      if (typeof pid === "number" && pid > 0) {
        try {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)]);
          } else {
            // detached:true above put the child in its own process group;
            // sending to -pid reaches every grandchild it spawned.
            process.kill(-pid, "SIGKILL");
          }
        } catch {}
      }
      done(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    // Write + end synchronously so fast-exiting children receive complete input.
    try {
      child.stdin?.write(inputJson, "utf-8");
      child.stdin?.end();
    } catch {
      // child already closed stdin (fast exit) — ignore
    }
    child.stdin?.on("error", () => {}); // ignore async EPIPE / broken-pipe errors

    child.on("close", () => {
      const out = stdout.trim();
      if (!out) {
        done(null);
        return;
      }
      try {
        done(JSON.parse(out) as HookOutput);
      } catch {
        done({ systemMessage: out });
      }
    });

    child.on("error", () => done(null));
  });
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

function getMatchingHooks(
  config: HooksConfig,
  event: HookEvent,
  toolName?: string,
): HookCommand[] {
  const matchers = config[event] ?? [];
  const result: HookCommand[] = [];
  for (const group of matchers) {
    if (!toolName || matchesMatcher(toolName, group.matcher)) {
      result.push(...group.hooks);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public hook runners — all async, deterministic execution order
// ---------------------------------------------------------------------------

export type PreToolHookResult = {
  blocked: boolean;
  reason?: string;
  systemMessage?: string;
};

export async function runPreToolHooks(
  toolName: string,
  input: unknown,
  sessionId: string,
): Promise<PreToolHookResult> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "PreToolUse", toolName);

  let systemMessage: string | undefined;

  for (const hook of hooks) {
    const hookInput: PreToolUseInput = {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      cwd: process.cwd(),
      tool_name: toolName,
      tool_input: input,
    };

    if (hook.async) {
      void execHook(hook, hookInput); // fire-and-forget
      continue;
    }

    const output = await execHook(hook, hookInput);
    if (!output) continue;

    if (output.decision === "block") {
      return { blocked: true, reason: output.reason };
    }
    if (output.systemMessage) {
      systemMessage = systemMessage
        ? `${systemMessage}\n${output.systemMessage}`
        : output.systemMessage;
    }
  }

  return { blocked: false, systemMessage };
}

export async function runPostToolHooks(
  toolName: string,
  input: unknown,
  response: unknown,
  sessionId: string,
): Promise<void> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "PostToolUse", toolName);
  const hookInput: PostToolUseInput = {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    cwd: process.cwd(),
    tool_name: toolName,
    tool_input: input,
    tool_response: response,
  };
  await Promise.all(hooks.map((hook) => execHook(hook, hookInput)));
}

export async function runPostToolUseFailureHooks(
  toolName: string,
  input: unknown,
  error: string,
  sessionId: string,
): Promise<void> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "PostToolUseFailure", toolName);
  const hookInput: PostToolUseInput = {
    hook_event_name: "PostToolUseFailure",
    session_id: sessionId,
    cwd: process.cwd(),
    tool_name: toolName,
    tool_input: input,
    tool_response: { error },
  };
  await Promise.all(hooks.map((hook) => execHook(hook, hookInput)));
}

export type UserPromptHookResult = {
  blocked: boolean;
  stopReason?: string;
  systemMessage?: string;
};

export async function runUserPromptSubmitHooks(
  prompt: string,
  sessionId: string,
): Promise<UserPromptHookResult> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "UserPromptSubmit");

  let systemMessage: string | undefined;

  for (const hook of hooks) {
    const hookInput: UserPromptSubmitInput = {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: process.cwd(),
      prompt,
    };

    if (hook.async) {
      void execHook(hook, hookInput);
      continue;
    }

    const output = await execHook(hook, hookInput);
    if (!output) continue;

    if (output.continue === false) {
      return { blocked: true, stopReason: output.stopReason };
    }
    if (output.systemMessage) {
      systemMessage = systemMessage
        ? `${systemMessage}\n${output.systemMessage}`
        : output.systemMessage;
    }
  }

  return { blocked: false, systemMessage };
}

// Tracks sessions where a Stop hook is currently executing, so re-entrant calls
// receive stop_hook_active: true and can break their own cycle.
const activeStopSessions = new Set<string>();

export async function runStopHooks(sessionId: string): Promise<void> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "Stop");
  const hookInput: StopInput = {
    hook_event_name: "Stop",
    session_id: sessionId,
    cwd: process.cwd(),
    stop_hook_active: activeStopSessions.has(sessionId),
  };
  activeStopSessions.add(sessionId);
  try {
    await Promise.all(hooks.map((hook) => execHook(hook, hookInput)));
  } finally {
    activeStopSessions.delete(sessionId);
  }
}
