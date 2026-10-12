/** Holds a session file's lock from another process, as a terminal would (§5.5). */
import { SessionManager } from "../../../src/core/session-manager.ts";

const manager = SessionManager.open(process.argv[2]);
process.stdout.write("locked\n");
process.stdin.resume();
process.stdin.on("end", () => {
	manager.close();
	process.exit(0);
});
