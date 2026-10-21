/**
 * "Open in editor" hands a file to the system's default app. A file type the system runs rather than opens
 * (a program, script or shortcut) is refused: opening one from a diff must never execute it.
 * ponytail: an extension list; detecting editors (desktop-shell.md section 9.9, `host/openIn/list`) replaces it.
 */

const RUNS = new Set([
	"exe",
	"com",
	"bat",
	"cmd",
	"ps1",
	"psm1",
	"vbs",
	"vbe",
	"js",
	"jse",
	"wsf",
	"wsh",
	"msi",
	"msp",
	"lnk",
	"scr",
	"hta",
	"pif",
	"cpl",
	"reg",
	"jar",
	"sh",
	"command",
	"app",
	"appimage",
	"run",
	"url",
	"desktop",
]);

/** Why `path` must not be opened, or undefined when it may be. */
export function refuseToOpen(path: string): string | undefined {
	const name = path.split(/[\\/]/).pop() ?? "";
	const dot = name.lastIndexOf(".");
	const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	return RUNS.has(extension) ? `${name} runs instead of opening; open it from your editor` : undefined;
}
