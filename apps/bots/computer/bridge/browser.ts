// Each bot's Chrome, driven over the DevTools protocol on its loopback debugging port: page snapshots with element
// references (backend node ids), acting on a reference, navigation, and server-side fills whose fields are masked so
// screenshots never show them. Snapshots never include field values.
import { chromeFlags } from "../desktop/chrome-flags.ts";
import { ensureSession, RUNUSER, run, type Session } from "./desktop.ts";

export type BrowserRequest =
	| { action: "snapshot" }
	| { action: "navigate"; url: string }
	| { action: "act"; ref: string; do: "click" | "type" | "select" | "press" | "hover"; text?: string }
	| { action: "fill"; ref: string; secret: string }
	| { action: "location" };

const SNAPSHOT_LINES = 400;

async function debugTarget(session: Session): Promise<string | undefined> {
	try {
		const targets = (await (await fetch(`http://127.0.0.1:${session.debugPort}/json`)).json()) as {
			type: string;
			webSocketDebuggerUrl?: string;
		}[];
		return targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
	} catch {
		return undefined;
	}
}

/** The bot's Chrome, started as the bot's user on its own display when it is not running. */
async function ensureChrome(user: string): Promise<{ session: Session; target: string }> {
	const session = await ensureSession(user);
	let target = await debugTarget(session);
	if (target) return { session, target };
	const flags = chromeFlags({
		profileDir: `/home/${user}/.config/chromium`,
		debugPort: session.debugPort,
		language: process.env.KB_LANGUAGE,
		proxy: process.env.KB_PROXY || undefined,
	});
	Bun.spawn([RUNUSER, "-u", user, "--", "google-chrome", ...flags, "about:blank"], {
		stdio: ["ignore", "ignore", "ignore"],
		env: {
			HOME: `/home/${user}`,
			USER: user,
			DISPLAY: `:${session.display}`,
			XAUTHORITY: `/home/${user}/.Xauthority`,
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			...(process.env.TZ ? { TZ: process.env.TZ } : {}),
		},
	});
	for (let i = 0; i < 100 && !target; i++) {
		await Bun.sleep(150);
		target = await debugTarget(session);
	}
	if (!target) throw new Error("Chrome did not start");
	return { session, target };
}

/** One DevTools session on a page: send a command, await its result. */
async function devtools<T>(url: string, use: (send: (method: string, params?: object) => Promise<any>) => Promise<T>): Promise<T> {
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
	});
	let next = 1;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
		const waiter = message.id === undefined ? undefined : pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id!);
		if (message.error) waiter.reject(new Error(message.error.message));
		else waiter.resolve(message.result);
	});
	const send = (method: string, params: object = {}) =>
		new Promise<any>((resolve, reject) => {
			const id = next++;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	try {
		return await use(send);
	} finally {
		socket.close();
	}
}

type AxNode = {
	ignored?: boolean;
	role?: { value?: string };
	name?: { value?: string };
	backendDOMNodeId?: number;
};

const SKIP_ROLES = new Set(["generic", "none", "InlineTextBox", "LineBreak", "RootWebArea", "StaticText"]);

async function pageInfo(send: (method: string, params?: object) => Promise<any>) {
	const evaluated = await send("Runtime.evaluate", { expression: "JSON.stringify([location.href, document.title])", returnByValue: true });
	const [url, title] = JSON.parse(evaluated.result.value as string) as [string, string];
	return { url, title };
}

async function center(send: (method: string, params?: object) => Promise<any>, backendNodeId: number) {
	await send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
	const { model } = await send("DOM.getBoxModel", { backendNodeId });
	const quad = model.content as number[];
	return { x: (quad[0]! + quad[4]!) / 2, y: (quad[1]! + quad[5]!) / 2 };
}

export async function browserAction(user: string, request: BrowserRequest) {
	const { target } = await ensureChrome(user);
	return devtools(target, async (send) => {
		await send("DOM.getDocument", { depth: 0 });
		switch (request.action) {
			case "location":
				return pageInfo(send);
			case "navigate": {
				if (!/^https?:\/\//i.test(request.url)) return { error: "Only http and https addresses can be opened." };
				await send("Page.navigate", { url: request.url });
				for (let i = 0; i < 100; i++) {
					const state = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
					if (state.result.value === "complete") break;
					await Bun.sleep(150);
				}
				return pageInfo(send);
			}
			case "snapshot": {
				const { nodes } = (await send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
				const lines: string[] = [];
				for (const node of nodes) {
					const role = node.role?.value ?? "";
					const name = (node.name?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
					if (node.ignored || SKIP_ROLES.has(role) || node.backendDOMNodeId === undefined) continue;
					if (!name && !["textbox", "combobox", "searchbox", "checkbox", "radio", "button", "link"].includes(role)) continue;
					lines.push(`[${node.backendDOMNodeId}] ${role}${name ? ` "${name}"` : ""}`);
					if (lines.length >= SNAPSHOT_LINES) {
						lines.push("…(more elements; scroll or navigate to see others)");
						break;
					}
				}
				return { ...(await pageInfo(send)), snapshot: lines.join("\n") };
			}
			case "act":
			case "fill": {
				const backendNodeId = Number(request.ref);
				if (!Number.isInteger(backendNodeId)) return { error: "Unknown ref; take a new browser_snapshot." };
				if (request.action === "fill") {
					await send("DOM.focus", { backendNodeId });
					const { object } = await send("DOM.resolveNode", { backendNodeId });
					// Masked before the value goes in, so no screenshot can catch it.
					await send("Runtime.callFunctionOn", {
						objectId: object.objectId,
						functionDeclaration:
							"function () { this.setAttribute('data-kb-masked', ''); this.style.webkitTextSecurity = 'disc'; this.value = ''; }",
					});
					await send("Input.insertText", { text: request.secret });
					return pageInfo(send);
				}
				if (request.do === "type" || request.do === "press") {
					await send("DOM.focus", { backendNodeId });
					if (request.do === "type") await send("Input.insertText", { text: request.text ?? "" });
					else
						for (const type of ["keyDown", "keyUp"])
							await send("Input.dispatchKeyEvent", { type, key: request.text ?? "Enter", code: request.text ?? "Enter" });
				} else if (request.do === "select") {
					const { object } = await send("DOM.resolveNode", { backendNodeId });
					await send("Runtime.callFunctionOn", {
						objectId: object.objectId,
						arguments: [{ value: request.text ?? "" }],
						functionDeclaration:
							"function (wanted) { const option = [...this.options].find((o) => o.value === wanted || o.label === wanted); if (option) { this.value = option.value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); } }",
					});
				} else {
					const { x, y } = await center(send, backendNodeId);
					await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
					if (request.do === "click")
						for (const type of ["mousePressed", "mouseReleased"])
							await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
				}
				await Bun.sleep(300);
				return pageInfo(send);
			}
		}
	});
}

/** Closes every bot's Chrome cleanly before a save, so profiles on disk are consistent. */
export async function quiesceBrowsers(sessions: Session[]): Promise<void> {
	await Promise.all(
		sessions.map(async (session) => {
			const target = await debugTarget(session);
			if (!target) return;
			try {
				const version = (await (await fetch(`http://127.0.0.1:${session.debugPort}/json/version`)).json()) as {
					webSocketDebuggerUrl: string;
				};
				await devtools(version.webSocketDebuggerUrl, (send) => send("Browser.close").catch(() => undefined));
			} catch {
				await run(["pkill", "-TERM", "-u", session.user, "chrome"]);
			}
			for (let i = 0; i < 50 && (await debugTarget(session)); i++) await Bun.sleep(100);
		}),
	);
}
