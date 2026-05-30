import { COMMANDS } from "./commands";
import type { Command } from "./types";
import { listSkills } from "../../lib/context/skills";

let cachedSkillCommands: Command[] = [];
let cachedAt = 0;
const TTL_MS = 3_000;

function skillsToCommands(): Command[] {
  const now = Date.now();
  if (now - cachedAt < TTL_MS) return cachedSkillCommands;

  cachedSkillCommands = listSkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    value: `/${skill.name}`,
    argumentHint: skill.argumentHint,
    action: (ctx) => {
      if (!ctx.submitCommand) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      const progress = `Running ${skill.name}…`;
      ctx.submitCommand(skill.body, progress);
    },
  }));
  cachedAt = now;
  return cachedSkillCommands;
}

function allCommands(): Command[] {
  const skills = skillsToCommands();
  // De-duplicate: skill names that collide with builtin commands keep the builtin
  const builtinNames = new Set(COMMANDS.map((c) => c.name));
  const filteredSkills = skills.filter((s) => !builtinNames.has(s.name));
  return [...COMMANDS, ...filteredSkills];
}

export function getFilteredCommands(query: string): Command[] {
  const all = allCommands();
  if (query.length === 0) return all;
  return all.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query.toLowerCase()),
  );
}
