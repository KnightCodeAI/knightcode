import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const PROCESSES_FILE = path.join(
  process.cwd(),
  ".knightcode",
  "processes.json",
);
const activeProcesses = new Map<number, any>();

export function killProcessOnPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return;
  }
  try {
    if (process.platform === "win32") {
      const res = spawnSync("netstat", ["-ano"], { encoding: "utf-8" });
      const output = res.stdout || "";
      const lines = output.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const localAddress = parts[1]; // e.g. "127.0.0.1:3000" or "[::1]:3000"
          const portMatch = localAddress?.match(/:(\d+)$/);
          const parsedPort = portMatch ? parseInt(portMatch[1]!, 10) : null;
          if (parsedPort === port && parts[parts.length - 2] === "LISTENING") {
            const pid = parts[parts.length - 1];
            if (
              pid &&
              /^\d+$/.test(pid) &&
              pid !== "0" &&
              pid !== String(process.pid)
            ) {
              spawnSync("taskkill", ["/F", "/PID", pid]);
            }
          }
        }
      }
    } else {
      const res = spawnSync(
        "lsof",
        ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
        { encoding: "utf-8" },
      );
      const output = res.stdout || "";
      const pids = output.trim().split("\n");
      for (const pid of pids) {
        const trimmedPid = pid.trim();
        if (
          trimmedPid &&
          /^\d+$/.test(trimmedPid) &&
          trimmedPid !== String(process.pid)
        ) {
          spawnSync("kill", ["-9", trimmedPid]);
        }
      }
    }
  } catch {
    // Port wasn't occupied or error
  }
}

export interface BackgroundProcess {
  pid: number;
  command: string;
  port?: number;
  startedAt: string;
  status: "running" | "stopped";
}

function ensureDirExists(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadRegistry(): Record<string, BackgroundProcess> {
  try {
    if (fs.existsSync(PROCESSES_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSES_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export function saveRegistry(registry: Record<string, BackgroundProcess>) {
  try {
    ensureDirExists(PROCESSES_FILE);
    fs.writeFileSync(
      PROCESSES_FILE,
      JSON.stringify(registry, null, 2),
      "utf-8",
    );
  } catch {}
}

export function registerProcess(
  pid: number,
  command: string,
  port?: number,
  proc?: any,
) {
  const registry = loadRegistry();
  registry[pid] = {
    pid,
    command,
    port,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  saveRegistry(registry);
  if (proc) {
    activeProcesses.set(pid, proc);
  }
}

export function unregisterProcess(pid: number) {
  const registry = loadRegistry();
  delete registry[pid];
  saveRegistry(registry);
  activeProcesses.delete(pid);
}

export function monitorProcessesHeartbeat() {
  const registry = loadRegistry();
  let changed = false;

  for (const pidStr of Object.keys(registry)) {
    const pid = parseInt(pidStr, 10);
    let isAlive = false;

    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch (err: any) {
      // Only ESRCH ("no such process") is a definitive "dead" signal on both
      // POSIX and Windows. EPERM ("permission denied") means the process
      // exists but is owned by another session — still alive from our POV.
      // Any other unexpected error code is treated as "unknown" and we err
      // on the side of keeping the registry entry so the next heartbeat can
      // retry instead of orphaning a live process.
      if (err?.code === "ESRCH") {
        isAlive = false;
      } else {
        isAlive = true;
      }
    }

    if (!isAlive) {
      delete registry[pidStr];
      activeProcesses.delete(pid);
      changed = true;
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
}

export function cleanupAllProcesses() {
  const registry = loadRegistry();
  const pidsToKill = Object.keys(registry);

  // 1. Send SIGTERM / taskkill to all processes first to start graceful shutdown
  for (const pidStr of pidsToKill) {
    const pid = parseInt(pidStr, 10);
    const pidStrClean = String(pid);
    if (!/^\d+$/.test(pidStrClean)) continue;

    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", pidStrClean]);
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {}
  }

  // 2. Synchronous 150ms sleep to let SIGTERM'd processes shut down gracefully
  // before we force-kill. Use Atomics rather than spawning a sleeper subprocess:
  // in a compiled standalone binary `process.execPath` is this CLI itself, so
  // `execPath -e ...` relaunches the TUI (parseCliArgs treats "-e" as the default
  // command) and spawnSync blocks forever waiting for that interactive child —
  // which is exactly what froze the terminal on /exit in the packaged build.
  if (pidsToKill.length > 0) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    } catch {}
  }

  // 3. Force-kill any remaining alive processes
  for (const pidStr of pidsToKill) {
    const pid = parseInt(pidStr, 10);
    const pidStrClean = String(pid);
    if (!/^\d+$/.test(pidStrClean)) continue;

    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {}

    if (isAlive) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/F", "/PID", pidStrClean]);
        } else {
          process.kill(pid, "SIGKILL");
        }
      } catch {}
    }

    activeProcesses.delete(pid);
    delete registry[pidStr];
  }
  saveRegistry(registry);
}
