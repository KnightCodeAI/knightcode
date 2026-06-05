import { parseCliArgs } from "./lib/cli/parse-args";
import { VERSION } from "./lib/version";
import { runDoctorHeadless } from "./lib/doctor/run-headless";

const command = parseCliArgs(process.argv.slice(2));

if (command.kind === "version") {
  process.stdout.write(VERSION + "\n");
  process.exit(0);
}

if (command.kind === "doctor") {
  process.exit(runDoctorHeadless());
}

// Only load the TUI for the default command — a dynamic import so the heavy
// @opentui/core + screen module graph is never evaluated for headless commands.
await import("./tui-main");
