import { join } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { readFile } from "fs/promises";

export interface ProjectDetection {
  frameworks: string[];
  packageManager: string;
  isTypeScript: boolean;
  dependencies: string[];
}

function parsePackageDependencies(pkg: any): {
  frameworks: string[];
  dependencies: string[];
} {
  const frameworksSet = new Set<string>();
  const dependencies: string[] = [];

  if (pkg && typeof pkg === "object") {
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const dep of Object.keys(allDeps)) {
      dependencies.push(dep);
      if (dep === "next") frameworksSet.add("Next.js");
      if (dep === "nuxt" || dep === "vue") frameworksSet.add("Vue/Nuxt");
      if (dep === "react" && !frameworksSet.has("Next.js"))
        frameworksSet.add("React");
      if (dep === "svelte" || dep === "@sveltejs/kit")
        frameworksSet.add("Svelte");
      if (dep === "hono") frameworksSet.add("Hono");
      if (dep === "prisma") frameworksSet.add("Prisma");
      if (dep === "tailwindcss") frameworksSet.add("TailwindCSS");
    }
  }

  // Ensure "React" is not included if "Next.js" is in frameworksSet
  if (frameworksSet.has("Next.js")) {
    frameworksSet.delete("React");
  }

  return {
    frameworks: Array.from(frameworksSet),
    dependencies,
  };
}

function extractDetectorsSync(
  cwd: string,
  packageJsonContents: string[],
  tsconfigExists: boolean,
): ProjectDetection {
  let packageManager = "npm";
  const isTypeScript = tsconfigExists;

  // Detect package manager based on lockfiles
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    packageManager = "bun";
  } else if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (existsSync(join(cwd, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (existsSync(join(cwd, "package-lock.json"))) {
    packageManager = "npm";
  }

  let frameworks: string[] = [];
  let dependencies: string[] = [];

  for (const packageJsonContent of packageJsonContents) {
    try {
      const pkg = JSON.parse(packageJsonContent);
      const parsed = parsePackageDependencies(pkg);
      frameworks = Array.from(new Set([...frameworks, ...parsed.frameworks]));
      dependencies = Array.from(
        new Set([...dependencies, ...parsed.dependencies]),
      );
    } catch {
      // Ignored
    }
  }

  return {
    frameworks,
    packageManager,
    isTypeScript,
    dependencies: dependencies.slice(0, 50), // Cap at 50 to avoid massive payloads
  };
}

function workspacePackageJsonPaths(cwd: string): string[] {
  const paths = [join(cwd, "package.json")];
  const workspaceDirs = ["packages", "apps"];

  for (const workspaceDir of workspaceDirs) {
    const absoluteWorkspaceDir = join(cwd, workspaceDir);
    if (!existsSync(absoluteWorkspaceDir)) continue;

    try {
      for (const entry of readdirSync(absoluteWorkspaceDir, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const packageJsonPath = join(
          absoluteWorkspaceDir,
          entry.name,
          "package.json",
        );
        if (existsSync(packageJsonPath)) {
          paths.push(packageJsonPath);
        }
      }
    } catch {
      // Ignore unreadable workspace directories.
    }
  }

  return Array.from(new Set(paths));
}

function hasTypeScriptConfig(cwd: string): boolean {
  if (existsSync(join(cwd, "tsconfig.json"))) return true;

  for (const workspaceDir of ["packages", "apps"]) {
    const absoluteWorkspaceDir = join(cwd, workspaceDir);
    if (!existsSync(absoluteWorkspaceDir)) continue;
    try {
      for (const entry of readdirSync(absoluteWorkspaceDir, {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          existsSync(join(absoluteWorkspaceDir, entry.name, "tsconfig.json"))
        ) {
          return true;
        }
      }
    } catch {
      // Ignore unreadable workspace directories.
    }
  }

  return false;
}

export function detectProjectStackSync(cwd = process.cwd()): ProjectDetection {
  const packageJsonContents: string[] = [];
  for (const packageJsonPath of workspacePackageJsonPaths(cwd)) {
    try {
      packageJsonContents.push(readFileSync(packageJsonPath, "utf-8"));
    } catch {}
  }

  return extractDetectorsSync(
    cwd,
    packageJsonContents,
    hasTypeScriptConfig(cwd),
  );
}

export async function detectProjectStack(
  cwd = process.cwd(),
): Promise<ProjectDetection> {
  const packageJsonContents: string[] = [];
  for (const packageJsonPath of workspacePackageJsonPaths(cwd)) {
    try {
      packageJsonContents.push(await readFile(packageJsonPath, "utf-8"));
    } catch {}
  }

  return extractDetectorsSync(
    cwd,
    packageJsonContents,
    hasTypeScriptConfig(cwd),
  );
}
