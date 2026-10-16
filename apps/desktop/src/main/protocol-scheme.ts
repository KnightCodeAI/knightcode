/** The `app://desktop` path rule (desktop-shell.md section 6.3), apart from Electron so it can be tested. */

import { join, normalize, relative, sep } from "node:path";

/** The file under `dir` that `pathname` names, or the status to answer when it is malformed or escapes `dir`. */
export function rendererPath(dir: string, pathname: string): string | 400 | 403 {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return 400;
	}
	const path = normalize(join(dir, decoded));
	const inside = relative(dir, path);
	if (inside.startsWith("..") || inside.includes(`..${sep}`)) return 403;
	return path;
}
