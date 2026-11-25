/** Real-loader composer replacement, foreign contributions, requests and renderer recovery. */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { MOD, openSettings, send, settle, test, type RunningDesktop } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");
test.use({ extras: { dialogs: true } });

async function returnToThread(page: Page) {
	await page.keyboard.press(`${MOD}+N`);
	await page.getByRole("button", { name: /^say hello (?:Unpin|Pin) thread Archive thread$/ }).click();
}

async function install(desktop: RunningDesktop): Promise<string> {
	const { page, app, agentDir } = desktop;
	await page.evaluate(() => {
		const live = new Set<EventListenerOrEventListenerObject>();
		const add = document.addEventListener.bind(document),
			remove = document.removeEventListener.bind(document);
		const record = () => {
			document.documentElement.dataset.kcSelectionListeners = String(live.size);
		};
		document.addEventListener = (
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (type === "selectionchange") {
				live.add(listener);
				record();
			}
			add(type, listener, options);
		};
		document.removeEventListener = (
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | EventListenerOptions,
		) => {
			if (type === "selectionchange") {
				live.delete(listener);
				record();
			}
			remove(type, listener, options);
		};
	});
	for (const name of ["01-composer-action", "03-contenteditable", "05-message-renderer"])
		cpSync(join(examples, name), join(agentDir, "desktop-extensions", name), { recursive: true });
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await openSettings(page, "Extensions & skills");
	let alternate = "";
	for (const name of ["01-composer-action", "03-contenteditable", "05-message-renderer"]) {
		const row = page.locator("[data-extension]").filter({ has: page.getByRole("heading", { name, exact: true }) });
		await row.getByRole("button", { name: "Trust frontend", exact: true }).click();
		if (name === "03-contenteditable") alternate = `${await row.getAttribute("data-extension")}/composer`;
	}
	await expect(page.getByLabel("Composer provider", { exact: true })).toHaveValue("builtin.composer/default");
	await page.getByLabel("Composer provider", { exact: true }).selectOption(alternate);
	await returnToThread(page);
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveAttribute("contenteditable", "true");
	return alternate;
}

async function assertSingleHosts(page: Page) {
	await expect(page.locator("[data-kc-editor]")).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-kc-selection-listeners", "1");
	expect(
		await page
			.locator("[data-kc-composer-host]")
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kc-composer-host")).sort()),
	).toEqual(["actions", "addMenu", "banners", "chips", "popups", "sendMenu", "suggestions"]);
	await expect(page.getByRole("button", { name: "Insert review note", exact: true })).toHaveCount(1);
	await expect(page.getByText("Review before sending", { exact: true })).toHaveCount(1);
}

async function pasteImage(desktop: RunningDesktop) {
	const png = await desktop.app.evaluate(({ nativeImage }) =>
		nativeImage
			.createFromBitmap(Buffer.alloc(32 * 32 * 4, 128), { width: 32, height: 32 })
			.toPNG()
			.toString("base64"),
	);
	await desktop.page.getByRole("textbox", { name: "Message", exact: true }).focus();
	await desktop.page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
	}, png);
	await desktop.page.keyboard.press(`${MOD}+V`);
	await expect(desktop.page.getByRole("button", { name: "Remove image", exact: true })).toHaveCount(1);
	return png;
}

test("contenteditable selection, focus, locks, popups, menus, configurable keys and suggestion precedence", async ({
	desktop,
}) => {
	test.setTimeout(180_000);
	const { page } = desktop;
	await install(desktop);
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await assertSingleHosts(page);
	await editor.fill("alpha beta");
	await editor.evaluate((element) => {
		const range = document.createRange();
		range.setStart(element.firstChild!, 6);
		range.setEnd(element.firstChild!, 10);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	});
	await page.getByRole("button", { name: "Insert review note", exact: true }).click();
	await expect(editor).toHaveText("alpha review");
	await expect(editor).toBeFocused();
	await page.getByRole("button", { name: "Focus editor end", exact: true }).click();
	await page.getByRole("button", { name: "Read caret anchor", exact: true }).click();
	await expect(page.getByLabel("Caret anchor", { exact: true })).toHaveText(/^\d+,\d+$/);
	await page.getByRole("button", { name: "Review popup", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Popup note", exact: true })).toBeFocused();
	await page.getByRole("button", { name: "Close review popup", exact: true }).click();
	await expect(editor).toBeFocused();
	await page.getByRole("button", { name: "Review popup", exact: true }).click();
	await editor.fill("newer typing");
	await page.getByRole("button", { name: "Insert popup note", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Review insertion" })).toContainText("stale");
	await expect(editor).toHaveText("newer typing");
	await page.getByRole("button", { name: "Close review popup", exact: true }).click();
	await page.getByRole("button", { name: "Lock input", exact: true }).click();
	await expect(editor).toHaveAttribute("contenteditable", "false");
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Insert review note", exact: true }).click();
	await expect(editor).toHaveText("newer typing");
	await page.getByRole("button", { name: "Unlock input", exact: true }).click();
	await editor.fill("menu target");
	await page.getByRole("button", { name: "Add files and more", exact: true }).click();
	await page.getByRole("button", { name: "Insert review menu note", exact: true }).click();
	await expect(editor).toHaveText("menu targetmenu");
	await expect(page.getByRole("button", { name: "Insert review menu note", exact: true })).toBeHidden();
	await editor.fill("paste ");
	await page.evaluate(() =>
		navigator.clipboard.write([
			new ClipboardItem({
				"text/plain": new Blob(["first\nsecond"], { type: "text/plain" }),
				"text/html": new Blob(["<b>first</b><div>second</div>"], { type: "text/html" }),
			}),
		]),
	);
	await editor.press(`${MOD}+V`);
	expect(await editor.evaluate((element) => element.textContent)).toBe("paste first\nsecond");
	await expect(editor.locator("b, p")).toHaveCount(0);
	await editor.fill("/");
	const active = page.locator("[data-composer] [data-active=true]").first();
	await expect(active).toBeVisible();
	const firstChoice = await active.innerText();
	await editor.press("ArrowDown");
	await expect(active).not.toHaveText(firstChoice, { useInnerText: true });
	await editor.press("ArrowUp");
	await expect(active).toHaveText(firstChoice, { useInnerText: true });
	await editor.press("Escape");
	await expect(active).toHaveCount(0);
	await editor.fill("/");
	await expect(active).toBeVisible();
	const messages = await page.locator('[class~="group/message"]').count();
	await editor.press("Enter");
	await expect(editor).not.toHaveText("/");
	await expect(page.locator('[class~="group/message"]')).toHaveCount(messages);
	await editor.fill("composing draft");
	await editor.dispatchEvent("compositionstart");
	await editor.press("Enter");
	await expect(editor).toContainText("composing draft");
	await expect(page.locator('[class~="group/message"]')).toHaveCount(messages);
	await editor.dispatchEvent("compositionend");
	await openSettings(page, "Keyboard shortcuts");
	await page.getByRole("button", { name: "Change shortcut for Send the message", exact: true }).click();
	await page.locator('input[value="Press shortcut"]').press("F6");
	await returnToThread(page);
	await editor.fill("say hello");
	await editor.press("Enter");
	await expect(editor).toHaveText("say hello\n");
	await expect(page.locator('[class~="group/message"]')).toHaveCount(messages);
	await editor.press("F6");
	await expect(editor).toHaveText("");
	await expect(page.getByText("External reply", { exact: true })).toHaveCount(2);
	await page.getByRole("button", { name: "Copy external reply", exact: true }).last().click();
	expect(await desktop.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Hello from the faux model.");
	await assertSingleHosts(page);
	await editor.fill("captured thread A draft");
	await page.getByRole("button", { name: "Editor contract checks", exact: true }).click();
	await page.getByRole("menuitem", { name: "Capture submit callback", exact: true }).click();
	await page.keyboard.press(`${MOD}+N`);
	await editor.fill("new thread B draft");
	await page.getByRole("button", { name: "Editor contract checks", exact: true }).click();
	await page.getByRole("menuitem", { name: "Run captured submit callback", exact: true }).click();
	await expect(page.getByLabel("Captured submit result", { exact: true })).toHaveText("unavailable");
	await expect(editor).toHaveText("new thread B draft");
	await returnToThread(page);
	await expect(editor).toHaveText("captured thread A draft");
	await assertSingleHosts(page);
});

test("composition-time provider deferral retains attachments, drops and foreign controls with one live adapter", async ({
	desktop,
}) => {
	test.setTimeout(180_000);
	const { page, app } = desktop;
	const alternate = await install(desktop);
	const png = await pasteImage(desktop);
	const droppedImage = join(desktop.project, "dropped.png");
	writeFileSync(droppedImage, Buffer.from(png, "base64"));
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.fill("drop ");
	const bounds = await editor.boundingBox();
	if (!bounds) throw new Error("Editor is not mounted");
	const cdp = await page.context().newCDPSession(page);
	const data = { items: [], files: [droppedImage, join(desktop.project, "README.md")], dragOperationsMask: 1 };
	for (const type of ["dragEnter", "dragOver", "drop"] as const)
		await cdp.send("Input.dispatchDragEvent", { type, x: bounds.x + 20, y: bounds.y + 10, data });
	await expect(editor).toContainText("@README.md");
	await cdp.detach();
	await expect(page.getByRole("button", { name: "Remove image", exact: true })).toHaveCount(2);
	const opened = app.waitForEvent("window");
	await page.getByRole("button", { name: "Chat actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Open in new window", exact: true }).click();
	const second = await opened;
	await settle(app, second, "light", { width: 1280, height: 820 });
	await openSettings(second, "Extensions & skills");
	await editor.focus();
	await editor.dispatchEvent("compositionstart");
	await editor.evaluate((element) => {
		element.textContent = "IME retained";
		const range = document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
	});
	await second.getByLabel("Composer provider", { exact: true }).selectOption("builtin.composer/default");
	await expect(page.locator('[data-kc-composer-pending="composition"]')).toHaveCount(1);
	await expect(editor).toHaveAttribute("contenteditable", "true");
	await editor.dispatchEvent("compositionend");
	await expect(editor).toHaveValue("IME retained");
	await expect(page.getByRole("button", { name: "Remove image", exact: true })).toHaveCount(2);
	await page.getByRole("button", { name: "Editor contract checks", exact: true }).click();
	await page.getByRole("menuitem", { name: "Dispose previous editor", exact: true }).click();
	await expect(page.getByLabel("Retired editor result", { exact: true })).toHaveText("unavailable");
	await page.getByRole("button", { name: "Focus editor end", exact: true }).click();
	await page.getByRole("button", { name: "Insert review note", exact: true }).click();
	await expect(editor).toHaveValue("IME retainedreview");
	await assertSingleHosts(page);
	await second.getByLabel("Composer provider", { exact: true }).selectOption(alternate);
	await expect(editor).toHaveAttribute("contenteditable", "true");
	await expect(editor).toHaveText("IME retainedreview");
	await page.getByRole("button", { name: "Review popup", exact: true }).click();
	const popup = page.getByRole("textbox", { name: "Popup note", exact: true });
	await popup.dispatchEvent("compositionstart");
	await second.getByLabel("Composer provider", { exact: true }).selectOption("builtin.composer/default");
	await expect(editor).toHaveValue("IME retainedreview");
	await expect(page.locator("[data-kc-composer-pending]")).toHaveCount(0);
	await page.getByRole("button", { name: "Close review popup", exact: true }).click();
	await expect(editor).toBeFocused();
	await page.getByRole("button", { name: "Remove image", exact: true }).first().click();
	await page.getByRole("button", { name: "Remove image", exact: true }).first().click();
	await editor.fill("wait for stop");
	await editor.press("Enter");
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	await editor.fill("queued from adapter");
	await editor.press("Enter");
	await expect(page.getByText("queued from adapter", { exact: true }).last()).toBeVisible();
	await editor.fill("steered from adapter");
	await editor.press(`${MOD}+Enter`);
	await expect(page.getByText(/^Steeringsteered from adapter$/)).toBeVisible();
	await expect(editor).toHaveValue("");
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await assertSingleHosts(page);
	await second.close();
});

test("invalid composer providers and a failed request presenter retain host recovery and refuse stale replies", async ({
	desktop,
}) => {
	test.setTimeout(180_000);
	const { page, agentDir } = desktop;
	await install(desktop);
	const directory = join(agentDir, "desktop-extensions", "broken-surfaces");
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ type: "module", knightcode: { desktop: { frontend: "./app.tsx" } } }),
	);
	writeFileSync(
		join(directory, "app.tsx"),
		`import {useState} from "react";
import {defineDesktopExtension,experimental_ComposerFrame as Frame,experimental_ComposerContributions as Contributions,experimental_TextareaEditor as Editor,experimental_conversationServices as services,type experimental_Request} from "@knightcodeai/cli/desktop";
let saved:experimental_Request|undefined;
function Late(){const [result,setResult]=useState("");return <><button onClick={()=>setResult(String(saved?.method==="ui/dialog" && services().experimental_answerDialog(saved.params.threadId,saved,{confirmed:true})))}>Late request reply</button><output aria-label="Late reply result">{result}</output></>;}
export default defineDesktopExtension(app=>{
 app.experimental_registerProvider({id:"missing",surface:"composer",experimental_render:()=> <div>No contribution hosts</div>});
 app.experimental_registerProvider({id:"duplicate",surface:"composer",experimental_render:()=> <><Frame/><Contributions host="actions"/></>});
 app.experimental_registerProvider({id:"editors",surface:"composer",experimental_render:()=> <Frame editor={<><Editor/><Editor/></>}/>});
 app.experimental_registerProvider({id:"requests",surface:"requests",experimental_render:({context})=>{saved=context.request;throw new Error("Request presenter failed");}});
 app.experimental_registerSlot({id:"late",surface:"composerActions",experimental_render:Late});
});`,
	);
	await openSettings(page, "Extensions & skills");
	const row = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "broken-surfaces", exact: true }) });
	await row.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const owner = await row.getAttribute("data-extension");
	for (const id of ["missing", "duplicate", "editors"]) {
		await page.getByLabel("Composer provider", { exact: true }).selectOption(`${owner}/${id}`);
		await returnToThread(page);
		await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveJSProperty("tagName", "TEXTAREA");
		await assertSingleHosts(page);
		await openSettings(page, "Extensions & skills");
	}
	await page.getByLabel("Composer provider", { exact: true }).selectOption("builtin.composer/default");
	await page.getByLabel("Requests provider", { exact: true }).selectOption(`${owner}/requests`);
	await returnToThread(page);
	await send(page, "/parity-confirm ");
	await expect(page.getByRole("button", { name: "Use default request controls", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Use default request controls", exact: true }).click();
	await page.getByRole("button", { name: /^No Esc$/ }).click();
	await expect(page.getByText("Kept the notes.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Late request reply", exact: true }).click();
	await expect(page.getByLabel("Late reply result", { exact: true })).toHaveText("false");
});
