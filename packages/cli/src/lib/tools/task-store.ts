import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface PersistedTask {
  id: string;
  subject: string;
  description: string;
  active_form?: string;
  status: TaskStatus;
  owner?: string;
  blocks: string[];
  blocked_by: string[];
  metadata: Record<string, unknown>;
  output: string[];
  created_at: string;
  updated_at: string;
}

interface TaskStoreData {
  next_id: number;
  tasks: PersistedTask[];
}

function storePath(executionRoot: string): string {
  return join(executionRoot, ".knightcode", "tasks.json");
}

/**
 * Synchronously check whether the workspace has any incomplete (pending or
 * in_progress) persisted tasks. Used to decide — without an async round-trip —
 * whether the deferred Task suite should be pre-loaded for the turn so the
 * model can resume cross-session work without a ToolSearch detour.
 */
export function hasIncompleteTasksSync(executionRoot: string): boolean {
  const file = storePath(executionRoot);
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<TaskStoreData>;
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    return tasks.some((t) => t.status === "pending" || t.status === "in_progress");
  } catch {
    return false;
  }
}

async function loadStore(executionRoot: string): Promise<TaskStoreData> {
  const file = storePath(executionRoot);
  if (!existsSync(file)) {
    return { next_id: 1, tasks: [] };
  }
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TaskStoreData>;
    return {
      next_id: typeof parsed.next_id === "number" ? parsed.next_id : 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return { next_id: 1, tasks: [] };
  }
}

async function persistStore(
  executionRoot: string,
  data: TaskStoreData,
): Promise<void> {
  const file = storePath(executionRoot);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, file);
}

const inflight = new Map<string, Promise<unknown>>();

async function withStore<T>(
  executionRoot: string,
  fn: (data: TaskStoreData) => Promise<T> | T,
): Promise<T> {
  const prev = inflight.get(executionRoot) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const data = await loadStore(executionRoot);
      const result = await fn(data);
      await persistStore(executionRoot, data);
      return result;
    });
  inflight.set(
    executionRoot,
    next.finally(() => {
      if (inflight.get(executionRoot) === next) {
        inflight.delete(executionRoot);
      }
    }),
  );
  return next;
}

export async function createTaskRecord(
  executionRoot: string,
  partial: {
    subject: string;
    description: string;
    active_form?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PersistedTask> {
  return withStore(executionRoot, (data) => {
    const id = String(data.next_id);
    data.next_id += 1;
    const now = new Date().toISOString();
    const task: PersistedTask = {
      id,
      subject: partial.subject,
      description: partial.description,
      active_form: partial.active_form,
      status: "pending",
      blocks: [],
      blocked_by: [],
      metadata: partial.metadata ?? {},
      output: [],
      created_at: now,
      updated_at: now,
    };
    data.tasks.push(task);
    return task;
  });
}

export async function listTasksSummary(
  executionRoot: string,
): Promise<
  Array<
    Pick<PersistedTask, "id" | "subject" | "status" | "owner" | "blocked_by">
  >
> {
  return withStore(executionRoot, (data) =>
    data.tasks.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      owner: t.owner,
      blocked_by: t.blocked_by,
    })),
  );
}

export async function getTaskRecord(
  executionRoot: string,
  task_id: string,
): Promise<PersistedTask | null> {
  return withStore(executionRoot, (data) => {
    return data.tasks.find((t) => t.id === task_id) ?? null;
  });
}

export interface UpdateTaskPatch {
  subject?: string;
  description?: string;
  active_form?: string;
  status?: TaskStatus | "deleted";
  owner?: string;
  add_blocks?: string[];
  add_blocked_by?: string[];
  metadata?: Record<string, unknown | null>;
}

export async function updateTaskRecord(
  executionRoot: string,
  task_id: string,
  patch: UpdateTaskPatch,
): Promise<PersistedTask | { deleted: true; id: string }> {
  return withStore(executionRoot, (data) => {
    const idx = data.tasks.findIndex((t) => t.id === task_id);
    if (idx === -1) throw new Error(`Task ${task_id} not found`);

    if (patch.status === "deleted") {
      data.tasks.splice(idx, 1);
      return { deleted: true as const, id: task_id };
    }

    const task = data.tasks[idx]!;
    if (patch.subject !== undefined) task.subject = patch.subject;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.active_form !== undefined) task.active_form = patch.active_form;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.owner !== undefined) task.owner = patch.owner;
    if (patch.add_blocks?.length) {
      for (const id of patch.add_blocks) {
        if (!task.blocks.includes(id)) task.blocks.push(id);
      }
    }
    if (patch.add_blocked_by?.length) {
      for (const id of patch.add_blocked_by) {
        if (!task.blocked_by.includes(id)) task.blocked_by.push(id);
      }
    }
    if (patch.metadata) {
      for (const [key, value] of Object.entries(patch.metadata)) {
        if (value === null) {
          delete task.metadata[key];
        } else {
          task.metadata[key] = value;
        }
      }
    }
    task.updated_at = new Date().toISOString();
    return task;
  });
}

export async function stopTaskRecord(
  executionRoot: string,
  task_id: string,
  reason?: string,
): Promise<PersistedTask> {
  return withStore(executionRoot, (data) => {
    const task = data.tasks.find((t) => t.id === task_id);
    if (!task) throw new Error(`Task ${task_id} not found`);
    if (task.status !== "in_progress") {
      throw new Error(
        `Task ${task_id} is not in_progress (current status: ${task.status}). Use TaskUpdate to change status.`,
      );
    }
    task.status = "pending";
    task.owner = undefined;
    if (reason) {
      task.output.push(
        `[${new Date().toISOString()}] Stopped: ${reason}`,
      );
    }
    task.updated_at = new Date().toISOString();
    return task;
  });
}

export async function appendTaskOutput(
  executionRoot: string,
  task_id: string,
  line: string,
): Promise<void> {
  await withStore(executionRoot, (data) => {
    const task = data.tasks.find((t) => t.id === task_id);
    if (!task) throw new Error(`Task ${task_id} not found`);
    task.output.push(line);
    task.updated_at = new Date().toISOString();
  });
}

export async function getTaskOutput(
  executionRoot: string,
  task_id: string,
  tail?: number,
): Promise<string[]> {
  return withStore(executionRoot, (data) => {
    const task = data.tasks.find((t) => t.id === task_id);
    if (!task) throw new Error(`Task ${task_id} not found`);
    if (tail !== undefined && tail > 0) {
      return task.output.slice(-tail);
    }
    return [...task.output];
  });
}
