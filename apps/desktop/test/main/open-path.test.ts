import { expect, test } from "vitest";
import { refuseToOpen } from "../../src/main/open-path.ts";

test("source files open; anything that would run instead of open is refused", () => {
	for (const path of ["C:\\repo\\src\\a.ts", "/repo/README.md", "/repo/data.json", "C:\\repo\\.env"])
		expect(refuseToOpen(path)).toBeUndefined();
	for (const path of [
		"C:\\repo\\setup.exe",
		"C:\\repo\\run.BAT",
		"C:\\repo\\x.cmd",
		"C:\\repo\\x.ps1",
		"C:\\repo\\x.js",
		"C:\\repo\\x.vbs",
		"C:\\repo\\shortcut.lnk",
		"/repo/install.sh",
		"/repo/Tool.app",
	])
		expect(refuseToOpen(path)).toMatch(/runs/);
});
