import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { knightcodeHome } from "./paths";

export type SettingsFile = { [key: string]: unknown };

export function getSettingsPath(): string {
  return join(knightcodeHome(), "settings.json");
}

export function loadSettings(): SettingsFile {
  const p = getSettingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as SettingsFile;
  } catch {
    return {};
  }
}

export function saveSettings(settings: SettingsFile): void {
  const dir = knightcodeHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

export interface SettingMeta {
  /** Nested path within settings.json. */
  path: string[];
  type: "string" | "boolean" | "number";
  /** Allowed values for validation. */
  options?: string[];
}

export const SUPPORTED_SETTINGS: Record<string, SettingMeta> = {
  theme: { path: ["theme"], type: "string", options: ["dark", "light", "system"] },
  model: { path: ["model"], type: "string" },
  defaultMode: {
    path: ["defaultMode"],
    type: "string",
    options: ["BUILD", "PLAN", "AUTO"],
  },
  reasoningEffort: {
    path: ["reasoningEffort"],
    type: "string",
    options: ["low", "medium", "high"],
  },
  /** Cheap model for background side queries (memory recall/extraction).
   *  Unset → falls back to the turn's main model. */
  sideQueryModel: { path: ["sideQueryModel"], type: "string" },
  /** Auto-memory (recall + extraction). On unless explicitly false. */
  "memory.enabled": { path: ["memory", "enabled"], type: "boolean" },
  /** Background memory consolidation ("dream"). Off unless explicitly true. */
  "memory.autoDream": { path: ["memory", "autoDream"], type: "boolean" },
  /** Min hours between consolidations (default 24). */
  "memory.dreamMinHours": { path: ["memory", "dreamMinHours"], type: "number" },
  /** Min sessions since last consolidation before it runs (default 5). */
  "memory.dreamMinSessions": {
    path: ["memory", "dreamMinSessions"],
    type: "number",
  },
  /** Side-query skill nudging. On unless explicitly false. */
  "skills.autoDiscover": {
    path: ["skills", "autoDiscover"],
    type: "boolean",
  },
  /** Hot-reload skills when SKILL.md files change. On unless explicitly false. */
  "skills.hotReload": { path: ["skills", "hotReload"], type: "boolean" },
};

export function isSupportedSetting(key: string): boolean {
  return key in SUPPORTED_SETTINGS;
}

export function getSettingMeta(key: string): SettingMeta | undefined {
  return SUPPORTED_SETTINGS[key];
}

export function getSettingValue(key: string): unknown {
  const meta = SUPPORTED_SETTINGS[key];
  if (!meta) return undefined;
  let cur: unknown = loadSettings();
  for (const seg of meta.path) {
    if (cur && typeof cur === "object" && seg in cur) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function setSettingValue(key: string, value: unknown): void {
  const meta = SUPPORTED_SETTINGS[key]!;
  const settings = loadSettings();
  let cur: Record<string, unknown> = settings;
  for (let i = 0; i < meta.path.length - 1; i++) {
    const seg = meta.path[i]!;
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[meta.path[meta.path.length - 1]!] = value;
  saveSettings(settings);
}
