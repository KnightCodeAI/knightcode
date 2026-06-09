export type CliCommand =
  | { kind: "version" }
  | { kind: "doctor" }
  | { kind: "tui" };

/** Map process.argv.slice(2) to a top-level command. Version is checked first. */
export function parseCliArgs(argv: string[]): CliCommand {
  if (argv.includes("--version") || argv.includes("-v")) {
    return { kind: "version" };
  }
  if (argv[0] === "doctor") {
    return { kind: "doctor" };
  }
  return { kind: "tui" };
}
