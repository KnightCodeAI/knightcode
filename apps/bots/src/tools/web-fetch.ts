// Web search and fetch for Workers (spec section 5): plain fetch, no Node modules. Fetch takes public http(s) addresses
// only, follows at most 5 redirects (each checked), and returns bounded readable text. Search reads DuckDuckGo's HTML
// results, as the CLI's search does without a key.
import { defineTool } from "@knightcode/durable";
import { obj, str } from "@knightcode/schema";

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 20_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "KnightCodeBots/1.0 (+https://bots.knightcode.dev)";

/** Hosts a bot may not reach: loopback, private and link-local ranges, and local names. */
export function isPublicHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
	const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
	}
	if (host.includes(":")) return !(host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
	return host.includes(".");
}

function checked(url: string): URL {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http and https addresses can be fetched.");
	if (!isPublicHost(parsed.hostname)) throw new Error("That address is not on the public internet.");
	return parsed;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (text: string) =>
	text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) =>
		code[0] === "#"
			? String.fromCodePoint(code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
			: (ENTITIES[code.toLowerCase()] ?? whole),
	);

/** Readable text from HTML: no scripts, styles or tags, block breaks kept as newlines. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, "")
			.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*/g, "\n\n")
		.trim();
}

async function readCapped(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.length;
	}
	await reader.cancel().catch(() => undefined);
	const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
	let offset = 0;
	for (const chunk of chunks) {
		const part = chunk.subarray(0, bytes.length - offset);
		bytes.set(part, offset);
		offset += part.length;
	}
	return new TextDecoder().decode(bytes);
}

export async function webFetch(url: string): Promise<{ url: string; status: number; title?: string; text: string }> {
	let target = checked(url);
	for (let hop = 0; hop <= 5; hop++) {
		const response = await fetch(target, {
			redirect: "manual",
			headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			target = checked(new URL(location, target).href);
			continue;
		}
		const type = response.headers.get("content-type") ?? "";
		if (!/text|json|xml|javascript/.test(type) && type) {
			await response.body?.cancel();
			return { url: target.href, status: response.status, text: `(${type} content is not text)` };
		}
		const body = await readCapped(response);
		const html = /html/.test(type) || /^\s*</.test(body);
		const title = html ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] : undefined;
		const text = html ? htmlToText(body) : body;
		return {
			url: target.href,
			status: response.status,
			...(title ? { title: decodeEntities(title).trim() } : {}),
			text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(truncated)` : text,
		};
	}
	throw new Error("Too many redirects.");
}

export type SearchResult = { title: string; url: string; snippet: string };

/** Results from DuckDuckGo's HTML page; its redirect links are unwrapped to the destination. */
export function parseDuckDuckGo(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	const anchors = [...html.matchAll(/<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>/g)];
	anchors.forEach((anchor, index) => {
		const href = /\bhref="([^"]+)"/.exec(anchor[1]!)?.[1];
		if (!href) return;
		let url = decodeEntities(href);
		const wrapped = /[?&]uddg=([^&]+)/.exec(url);
		if (wrapped) url = decodeURIComponent(wrapped[1]!);
		if (url.startsWith("//")) url = `https:${url}`;
		const chunk = html.slice(anchor.index, anchors[index + 1]?.index ?? html.length);
		const snippet = /\bclass="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/.exec(chunk)?.[1] ?? "";
		results.push({ title: htmlToText(anchor[2]!), url, snippet: htmlToText(snippet) });
	});
	return results;
}

export async function webSearch(query: string): Promise<SearchResult[]> {
	const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: { "user-agent": USER_AGENT },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Search failed (${response.status}).`);
	return parseDuckDuckGo(await readCapped(response)).slice(0, 8);
}

const text = (value: unknown) => ({ output: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failure = (error: unknown) => ({
	output: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
	isError: true,
});

export const webTools = () => [
	defineTool({
		name: "web_search",
		description: "Search the web. Returns titles, links and snippets.",
		parameters: obj({ query: str() }),
		execute: async ({ query }) => webSearch(query).then(text, failure),
	}),
	defineTool({
		name: "web_fetch",
		description: "Read a public web page as text (bounded).",
		parameters: obj({ url: str() }),
		execute: async ({ url }) => webFetch(url).then(text, failure),
	}),
];
