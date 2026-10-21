/** Holds a session file's lock, as a second app server or terminal with the thread open would, until stdin ends. */
import { acquireSessionLock } from "../../src/core/session-lock.ts";

const lock = acquireSessionLock(process.argv[2]!);
process.stdout.write("taken\n");
process.stdin.on("end", () => {
	lock.release();
	process.exit(0);
});
process.stdin.resume();
