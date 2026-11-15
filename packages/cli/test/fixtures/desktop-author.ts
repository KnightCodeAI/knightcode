/** Exercise the real authoring implementation under the desktop's Bun runtime. */
import { runDesktopExtCommand } from "../../src/cli/desktop-ext.ts";
const [agentDir, ...args] = process.argv.slice(2);
const lines: string[] = [];
const code = await runDesktopExtCommand(args, { agentDir: agentDir!, cwd: agentDir!, output: line => lines.push(line) });
console.log(JSON.stringify({ code, lines }));
