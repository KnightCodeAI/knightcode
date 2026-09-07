import { encodeFrame, type StampedFrame } from "../../../packages/remote/src/protocol.ts";

const transcript = document.getElementById("transcript") as HTMLElement;
const connection = document.getElementById("connection") as HTMLElement;
const sessionName = document.getElementById("session-name") as HTMLElement;
const composer = document.getElementById("composer") as HTMLFormElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const stopButton = document.getElementById("stop") as HTMLButtonElement;

const roomId = location.pathname.split("/")[2] ?? "";
let socket: WebSocket | undefined;
let lastSeq = 0;
let liveNode: HTMLElement | undefined;

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * Minimal markdown: fenced code, inline code, bold, and paragraph breaks. Escaping runs
 * first and every tag emitted below is a literal, so transcript content cannot inject HTML.
 */
function renderMarkdown(source: string): string {
	const escaped = escapeHtml(source);
	return escaped
		.replace(/```([\s\S]*?)```/g, (_match, code: string) => `<pre><code>${code.trim()}</code></pre>`)
		.replace(/`([^`\n]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\n{2,}/g, "</p><p>");
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				typeof block === "object" && block !== null && (block as { type: string }).type === "text",
		)
		.map((block) => block.text)
		.join("");
}

function toolCallsOf(content: unknown): Array<{ name: string; arguments: unknown }> {
	if (!Array.isArray(content)) return [];
	return content
		.filter(
			(block): block is { type: string; name: string; arguments: unknown } =>
				typeof block === "object" && block !== null && (block as { type: string }).type === "toolCall",
		)
		.map((block) => ({ name: block.name, arguments: block.arguments }));
}

function appendEntry(entry: unknown): void {
	const record = entry as { type?: string; message?: { role?: string; content?: unknown } };
	if (record.type !== "message" || !record.message) return;
	const role = record.message.role ?? "assistant";
	const article = document.createElement("article");
	article.className = `entry entry-${role}`;

	const body = textOf(record.message.content);
	if (body.trim().length > 0) article.innerHTML = `<p>${renderMarkdown(body)}</p>`;

	for (const call of toolCallsOf(record.message.content)) {
		const details = document.createElement("details");
		details.className = "tool";
		details.innerHTML = `<summary>${escapeHtml(call.name)}</summary><pre><code>${escapeHtml(
			JSON.stringify(call.arguments, null, 2),
		)}</code></pre>`;
		article.append(details);
	}

	if (article.childNodes.length === 0) return;
	transcript.append(article);
}

function applyFrame(frame: StampedFrame): void {
	if (typeof frame.seq === "number") lastSeq = Math.max(lastSeq, frame.seq);
	if (frame.type === "snapshot") {
		transcript.replaceChildren();
		liveNode = undefined;
		if (frame.sessionName) sessionName.textContent = frame.sessionName;
		for (const entry of frame.entries) appendEntry(entry);
	} else if (frame.type === "entries") {
		liveNode?.remove();
		liveNode = undefined;
		for (const entry of frame.entries) appendEntry(entry);
	} else if (frame.type === "stream") {
		if (!liveNode) {
			liveNode = document.createElement("article");
			liveNode.className = "entry entry-assistant entry-live";
			transcript.append(liveNode);
		}
		liveNode.innerHTML = `<p>${renderMarkdown(frame.content)}</p>`;
	} else if (frame.type === "status") {
		stopButton.hidden = !frame.streaming;
	} else if (frame.type === "bye") {
		connection.textContent = "offline";
		connection.classList.add("offline");
	}
	transcript.scrollTop = transcript.scrollHeight;
}

function connect(): void {
	socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/r/${roomId}/ws`);
	socket.addEventListener("open", () => {
		connection.textContent = "live";
		connection.classList.remove("offline");
		socket?.send(encodeFrame(lastSeq > 0 ? { v: 1, type: "hello", since: lastSeq } : { v: 1, type: "hello" }));
	});
	socket.addEventListener("message", (event) => {
		try {
			applyFrame(JSON.parse(String(event.data)) as StampedFrame);
		} catch {
			// A frame the client cannot parse is skipped rather than breaking the stream.
		}
	});
	socket.addEventListener("close", () => {
		connection.textContent = "reconnecting";
		setTimeout(connect, 2000);
	});
}

composer.addEventListener("submit", (event) => {
	event.preventDefault();
	const text = input.value.trim();
	if (text.length === 0 || socket?.readyState !== WebSocket.OPEN) return;
	socket.send(encodeFrame({ v: 1, type: "prompt", text }));
	input.value = "";
	input.style.height = "auto";
});

input.addEventListener("input", () => {
	input.style.height = "auto";
	input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

stopButton.addEventListener("click", () => {
	if (socket?.readyState === WebSocket.OPEN) socket.send(encodeFrame({ v: 1, type: "abort" }));
});

// Keep the composer above the iOS keyboard rather than under it.
visualViewport?.addEventListener("resize", () => {
	document.documentElement.style.setProperty("--viewport-height", `${visualViewport?.height ?? 0}px`);
});

connect();
