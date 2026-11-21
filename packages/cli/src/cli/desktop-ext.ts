/** Binary-accessible desktop authoring; creation and validation never grant native consent. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDocsPath, getExamplesPath } from "../config.ts";
import { stageDesktopExtension } from "../app-server/desktop-extensions/artifacts.ts";
import { desktopControls } from "../app-server/desktop-extensions/control.ts";

export const DESKTOP_EXT_HELP = `Usage: knightcode desktop-ext <command> [--json]
  new <name>       Create <agent dir>/desktop-extensions/<name> (default ~/.knightcode/agent)
  validate <dir>   Validate local TSX/ESM and CSS without executing setup
  reload           Request reload in every running desktop window
  status           Read consent, revisions and per-window diagnostics
  --json           Emit one JSON result, including errors
  --help           Show this help

Creation does not approve code. Review it in Settings → Extensions & skills.
Choose Trust development reloads to watch future edits at that source.
`;

/** Run an authoring command with explicit filesystem roots and an output sink. */
export async function runDesktopExtCommand(
	args: string[],
	options: {
		agentDir: string;
		cwd: string;
		output(line: string): void;
	},
): Promise<number> {
	const json = args.includes("--json");
	const emit = (value: object, human: string) => options.output(json ? JSON.stringify(value) : human);
	try {
		const positional = args.filter((arg) => arg !== "--json");
		if (!positional.length || (positional.length === 1 && ["--help", "-h"].includes(positional[0]!))) {
			emit({ help: DESKTOP_EXT_HELP }, DESKTOP_EXT_HELP);
			return 0;
		}
		const [command, argument] = positional;
		const count = command === "new" || command === "validate" ? 2 : 1;
		if (positional.length !== count || positional.some((arg) => arg.startsWith("-"))) throw new Error(DESKTOP_EXT_HELP);
		if (command === "new") {
			if (!argument || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(argument) || argument.length > 64)
				throw new Error("Use a lowercase extension name with letters, numbers and single hyphens (max 64).");
			const directory = join(options.agentDir, "desktop-extensions");
			mkdirSync(directory, { recursive: true });
			const source = join(directory, argument);
			mkdirSync(source);
			writeFileSync(
				join(source, "package.json"),
				JSON.stringify(
					{
						name: argument,
						private: true,
						type: "module",
						knightcode: { desktop: { frontend: "./app.tsx", styles: ["./app.css"] } },
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(source, "app.tsx"),
				`import { defineDesktopExtension } from "@knightcodeai/cli/desktop";

export default defineDesktopExtension((app) => {
	app.experimental_registerSlot({
		id: "notice",
		surface: "feedback",
		experimental_render: () => <span className="notice">Desktop extension ready</span>,
	});
});
`,
			);
			writeFileSync(join(source, "app.css"), ".notice { color: var(--kc-text); font-family: var(--kc-font-ui); }\n");
			emit(
				{
					source,
					guide: join(getDocsPath(), "desktop-extensions.md"),
					examples: join(getExamplesPath(), "desktop-extensions"),
				},
				`Created ${source}\nReview and approve in Settings → Extensions & skills.\nGuide: ${join(getDocsPath(), "desktop-extensions.md")}`,
			);
		} else if (command === "validate") {
			const cache = mkdtempSync(join(tmpdir(), "kc-desktop-validate-"));
			try {
				const source = resolve(options.cwd, argument!);
				const artifact = await stageDesktopExtension(source, cache, "validation");
				emit(
					{ valid: true, source, revision: artifact.revision, files: artifact.files },
					`Valid: ${source}\nSetup and rendering are checked on activation; inspect desktop-ext status --json afterward.`,
				);
			} finally {
				rmSync(cache, { recursive: true, force: true });
			}
		} else if (command === "status" || command === "reload") {
			const result = await desktopControls(options.agentDir, command, options.cwd);
			emit(
				result,
				command === "reload"
					? `Reload requested in ${result.servers.length} desktop server(s). Read status for activation results.${result.unavailable.length ? `\nUnavailable: ${result.unavailable.join("\n")}` : ""}`
					: JSON.stringify(result, null, 2),
			);
			if (result.unavailable.length) return 1;
		} else throw new Error(DESKTOP_EXT_HELP);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ error: message }, `Error: ${message}`);
		return 1;
	}
}
