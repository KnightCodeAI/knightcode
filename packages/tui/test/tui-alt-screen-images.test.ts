// Kitty placements must survive row clears and text updates in fullscreen terminals.
import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Image } from "../src/components/image.ts";
import { resetCapabilitiesCache, setCapabilities, setCellDimensions } from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class RecordingTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

for (const termProgram of ["WezTerm", "Orca"]) {
	describe(`${termProgram} fullscreen Kitty images`, () => {
		let previousTermProgram: string | undefined;
		let previousWeztermPane: string | undefined;
		let tui: TuiAltScreen;
		let terminal: RecordingTerminal;
		let imageLine: string;
		let coveredLine: string;
		let footer: string;

		beforeEach(() => {
			previousTermProgram = process.env.TERM_PROGRAM;
			previousWeztermPane = process.env.WEZTERM_PANE;
			process.env.TERM_PROGRAM = termProgram;
			delete process.env.WEZTERM_PANE;
			setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
			setCellDimensions({ widthPx: 10, heightPx: 10 });
			terminal = new RecordingTerminal(20, 6);
			tui = new TuiAltScreen(terminal);
			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: (value) => value },
				{ maxWidthCells: 2, maxHeightCells: 3 },
				{ widthPx: 20, heightPx: 30 },
			);
			imageLine = image.render(20)[0];
			coveredLine = "";
			footer = "after";
			tui.setLayoutRoot({
				render: () => ["before", imageLine, coveredLine, "", footer],
				invalidate: () => {},
			});
		});

		afterEach(() => {
			tui.stop({ preserveScreen: true });
			resetCapabilitiesCache();
			setCellDimensions({ widthPx: 9, heightPx: 18 });
			if (previousTermProgram === undefined) delete process.env.TERM_PROGRAM;
			else process.env.TERM_PROGRAM = previousTermProgram;
			if (previousWeztermPane === undefined) delete process.env.WEZTERM_PANE;
			else process.env.WEZTERM_PANE = previousWeztermPane;
		});

		it("draws the complete image after clearing its reserved rows", async () => {
			tui.start();
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			const drawIndex = output.indexOf(imageLine);
			assert.ok(drawIndex >= 0, "the image must be uploaded and placed");
			assert.ok(drawIndex > output.lastIndexOf("\x1b[2K"), "row clears must precede the image placement");
			assert.ok(drawIndex > output.indexOf(footer), "text writes must precede the image placement");
			assert.strictEqual(terminal.getViewport()[4].trimEnd(), "after");
		});

		it("restores the placement after a covered row changes without uploading again", async () => {
			tui.start();
			await terminal.waitForRender();
			terminal.writes.length = 0;

			coveredLine = "changed";
			tui.requestRender();
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			const drawIndex = output.indexOf("\x1b_Ga=p,q=2");
			assert.ok(output.includes("\x1b_Ga=d,d=a,q=2\x1b\\"), "stale placements must be removed");
			assert.ok(drawIndex > output.indexOf("changed"), "the image must be restored after the covered-row write");
			assert.ok(drawIndex > output.lastIndexOf("\x1b[2K"), "no later clear may erase the restored placement");
			assert.ok(!output.includes("\x1b_Ga=T"), "unchanged image data must not be uploaded again");
			assert.strictEqual(terminal.getViewport()[2].trimEnd(), "changed");
		});

		it("does not redraw images when only text outside the image changes", async () => {
			tui.start();
			await terminal.waitForRender();
			terminal.writes.length = 0;

			footer = "updated";
			tui.requestRender();
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			assert.ok(!output.includes("\x1b_G"), "unrelated updates must not touch the image");
			assert.strictEqual(terminal.getViewport()[4].trimEnd(), "updated");
		});

		it("places the cached image last after a terminal resize", async () => {
			tui.start();
			await terminal.waitForRender();
			terminal.writes.length = 0;

			terminal.resize(22, 7);
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			const drawIndex = output.indexOf("\x1b_Ga=p,q=2");
			assert.ok(drawIndex > output.lastIndexOf("\x1b[2K"), "resize clears must precede the cached placement");
			assert.ok(drawIndex > output.indexOf(footer), "resize text writes must precede the cached placement");
			assert.ok(!output.includes("\x1b_Ga=T"), "resize must reuse the uploaded image");
		});
	});
}
