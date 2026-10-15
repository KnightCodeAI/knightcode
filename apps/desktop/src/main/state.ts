/** `<userData>/desktop-state.json` (desktop-shell.md section 7.3): atomic writes, corrupt files set aside. */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { DEFAULT_STATE, DesktopState } from "../shared/host-protocol.ts";

const checkState = Compile(DesktopState);

export class StateFile {
	private readonly path: string;

	constructor(userData: string) {
		this.path = join(userData, "desktop-state.json");
	}

	read(): DesktopState {
		if (!existsSync(this.path)) return structuredClone(DEFAULT_STATE);
		try {
			const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
			if (checkState.Check(parsed)) return parsed;
		} catch {
			// Falls through to setting the file aside.
		}
		try {
			renameSync(this.path, join(this.path, "..", `desktop-state.corrupt-${Date.now()}.json`));
		} catch {
			// The defaults still apply; the next write replaces the file.
		}
		return structuredClone(DEFAULT_STATE);
	}

	write(state: DesktopState): void {
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, JSON.stringify(state, null, 2));
		renameSync(temp, this.path);
	}
}
