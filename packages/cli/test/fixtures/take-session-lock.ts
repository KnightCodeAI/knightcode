/** Takes a session file's lock from another process, as a terminal would after the holder's lock expired. */
import { acquireSessionLock } from "../../src/core/session-lock.ts";

const lock = acquireSessionLock(process.argv[2]);
process.stdout.write("taken\n");
process.stdin.resume();
process.stdin.on("end", () => {
	lock.release();
	process.exit(0);
});
