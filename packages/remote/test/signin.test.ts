import type { Theme } from "@knightcodeai/cli";
import type { TUI } from "@knightcode/tui";
import { expect, test } from "vitest";
import { SignInScreen } from "../src/signin.ts";

/** Colourless theme: the assertions are about what the screen says, not how it is painted. */
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const tui = { requestRender: () => {} } as unknown as TUI;

function render(screen: SignInScreen): string {
	return screen.render(72).join("\n");
}

test("shows the code, the approval url and the machine being signed in", () => {
	const screen = new SignInScreen(tui, theme, "DESKTOP-1", () => {});
	try {
		expect(render(screen)).not.toContain("BCDF-2345");

		screen.showCode("BCDF-2345", "https://remote.knightcode.dev/device?code=BCDF-2345");
		const shown = render(screen);
		expect(shown).toContain("BCDF-2345");
		expect(shown).toContain("https://remote.knightcode.dev/device?code=BCDF-2345");
		expect(shown).toContain("DESKTOP-1");

		screen.showApproved();
		const approved = render(screen);
		expect(approved).toContain("Approved in your browser");
		expect(approved).not.toContain("BCDF-2345");
	} finally {
		screen.dispose();
	}
});
