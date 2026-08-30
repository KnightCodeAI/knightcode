// scripts/bench.ts — run Terminal-Bench against the current working tree.
//
//   bun run bench                            # default model, full dataset
//   bun run bench -t <task-id>               # one task
//   bun run bench -l 10 -k 2 -n 4            # 10 tasks, 2 attempts, 4 concurrent
//   bun run bench --no-build                 # reuse the existing binary
//   bun run bench -m <provider/model>        # something other than the default
//
// Everything after the script name is forwarded to `harbor run`, so any harbor
// flag works. Defaults are only applied when you did not pass them yourself.
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
const AGENT = "bench.knightcode_agent:KnightCode";
// Pinned: an unpinned ref resolves to the `latest` tag, which moves when they
// publish. 4.0.0 is what `latest` points at today — 66 tasks, content hash
// 39d9f44b… Bump deliberately so two runs stay comparable.
const DATASET = "terminal-bench/terminal-bench@4.0.0";
// In KnightCode's own catalog (providers/data/openrouter.json), so the agent runs
// on the built-in entry — 1M context, openrouter thinking format, real cost data.
const MODEL = "openrouter/deepseek/deepseek-v4-flash-0731";
const BINARY = join(ROOT, "packages/cli-linux-x64/bin/knightcode");

const args = process.argv.slice(2);
const has = (...flags: string[]) => flags.some((f) => args.includes(f));

if (has("-h", "--help")) {
  console.log(
    [
      "bun run bench [--no-build] <harbor run flags>",
      "",
      "  -t <task-id>          run a single task",
      "  -l <n> / -k <n>       limit tasks / attempts per task",
      "  -n <n>                concurrent trials",
      "  -e daytona|modal      run off local Docker",
      "  -m <provider/model>   override the default model",
      "  --ak thinking=<lvl>   off|minimal|low|medium|high|xhigh|max",
      "",
      `Defaults: -m ${MODEL}`,
      `          -d ${DATASET}`,
      `          -a ${AGENT}`,
      "",
      "Needs OPENROUTER_API_KEY in the environment.",
    ].join("\n"),
  );
  process.exit(0);
}

const forwarded = args.filter((a) => a !== "--no-build");

// harbor installs as its own isolated venv, so cwd is not on sys.path and the
// adapter would not import. PYTHONPATH is the one thing that reaches into it.
const env = { ...process.env, PYTHONPATH: ROOT };

if (!args.includes("--no-build")) {
  console.log("Building linux-x64 binary…");
  const build = Bun.spawnSync({
    cmd: ["bun", "run", join(ROOT, "scripts/build.ts"), "--target=linux-x64"],
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
} else if (!existsSync(BINARY)) {
  console.error(`bench: no binary at ${BINARY}. Drop --no-build.`);
  process.exit(1);
}

if (!Bun.which("harbor")) {
  console.error("bench: `harbor` not found on PATH. Install it with:\n  uv tool install harbor");
  process.exit(1);
}

const cmd = ["harbor", "run"];
if (!has("-d", "--dataset", "-p", "--path", "--repo")) cmd.push("-d", DATASET);
if (!has("-a", "--agent")) cmd.push("-a", AGENT);
if (!has("-m", "--model")) cmd.push("-m", MODEL);
cmd.push(...forwarded);

console.log(`$ ${cmd.join(" ")}`);
const run = Bun.spawnSync({ cmd, cwd: ROOT, env, stdio: ["inherit", "inherit", "inherit"] });
process.exit(run.exitCode ?? 1);
