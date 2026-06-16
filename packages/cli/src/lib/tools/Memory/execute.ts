import { Memory, type KnightcodeTool } from "@repo/shared";
import { scanMemoryFiles } from "../../memory/scan";
import { deleteMemory, readMemoryBody, upsertMemory } from "../../memory/store";

export const tool: KnightcodeTool = Memory;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { action, name, description, type, body } =
    Memory.input_schema.parse(input);
  const cwd = ctx.executionRoot;

  if (action === "list") {
    const memories = scanMemoryFiles(cwd).map((m) => ({
      name: m.name,
      description: m.description,
      type: m.type,
    }));
    return { action, count: memories.length, memories };
  }

  if (action === "get") {
    if (!name) {
      return { action, found: false, error: "get requires `name`." };
    }
    const body = readMemoryBody(cwd, name);
    return body !== null
      ? { action, found: true, name, body }
      : {
          action,
          found: false,
          error: `No memory named "${name}". Use action:"list" for exact names.`,
        };
  }

  if (action === "delete") {
    if (!name) {
      return { action, success: false, error: "delete requires `name`." };
    }
    const ok = deleteMemory(cwd, name);
    return ok
      ? { action, success: true, deleted: name }
      : {
          action,
          success: false,
          error: `No memory named "${name}". Use action:"list" for exact names.`,
        };
  }

  // update
  if (!name || !type || !body || !description?.trim()) {
    return {
      action,
      success: false,
      error: "update requires `name`, `type`, `description`, and `body`.",
    };
  }
  const changed = upsertMemory(cwd, { name, description, type, body });
  return { action, success: true, updated: name, changed };
}
