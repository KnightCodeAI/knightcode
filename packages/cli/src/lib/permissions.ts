import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

export interface PermissionsSchema {
  allowedCommands: string[];
}

function getPermissionsPath(): string {
  return join(homedir(), ".knightcode", "permissions.json");
}

function normalizePermissions(input: unknown): PermissionsSchema {
  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as PermissionsSchema).allowedCommands)
  ) {
    return {
      allowedCommands: (input as PermissionsSchema).allowedCommands.filter(
        (v): v is string => typeof v === "string",
      ),
    };
  }
  return { allowedCommands: [] };
}

export function loadPermissions(): PermissionsSchema {
  const filePath = getPermissionsPath();
  if (!existsSync(filePath)) {
    return { allowedCommands: [] };
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.allowedCommands)
    ) {
      throw new Error(
        "Invalid permissions schema: allowedCommands must be an array",
      );
    }
    return normalizePermissions(parsed);
  } catch {
    return { allowedCommands: [] };
  }
}

export function savePermissions(permissions: PermissionsSchema): void {
  const filePath = getPermissionsPath();
  const dir = join(homedir(), ".knightcode");
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(permissions, null, 2), "utf-8");
  } catch {}
}

export function isCommandAllowed(command: string): boolean {
  const permissions = loadPermissions();

  const normalised = command.trim();
  return permissions.allowedCommands.some((allowed) => {
    const pattern = allowed.trim();
    return normalised === pattern || normalised.startsWith(`${pattern} `);
  });
}

export function allowCommand(commandPattern: string): void {
  const permissions = loadPermissions();
  const pattern = commandPattern.trim();
  if (!permissions.allowedCommands.includes(pattern)) {
    permissions.allowedCommands.push(pattern);
    savePermissions(permissions);
  }
}
