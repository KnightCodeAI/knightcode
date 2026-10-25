/**
 * The app server's log (desktop-shell.md section 5.1): appended to its file, which rolls over at 5 MiB into `.1`
 * (newest) up to `.4`, so at most five files. Writes are synchronous (the server's stderr is small) so the file is
 * closed before it is renamed: Windows refuses to rename onto a file still open.
 */

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const FILES = 5;

export class RotatingLog {
	private readonly path: string;
	private readonly maxBytes: number;
	private fd: number | undefined;
	private size = 0;

	constructor(path: string, maxBytes = MAX_BYTES) {
		this.path = path;
		this.maxBytes = maxBytes;
	}

	/** Never throws: a log that cannot be written must not take main down. */
	write(text: string | Buffer): void {
		try {
			if (this.fd === undefined) {
				mkdirSync(dirname(this.path), { recursive: true });
				this.fd = openSync(this.path, "a");
				this.size = fstatSync(this.fd).size;
			}
			this.size += writeSync(this.fd, typeof text === "string" ? Buffer.from(text) : text);
			if (this.size >= this.maxBytes) this.rotate();
		} catch {
			// Disk full, or a file held open elsewhere: the next write tries again.
		}
	}

	end(): void {
		if (this.fd !== undefined) closeSync(this.fd);
		this.fd = undefined;
	}

	private rotate(): void {
		this.end();
		for (let i = FILES - 1; i >= 1; i--) {
			const from = i === 1 ? this.path : `${this.path}.${i - 1}`;
			if (existsSync(from)) renameSync(from, `${this.path}.${i}`);
		}
	}
}
