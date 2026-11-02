// Web search and fetch for Workers (spec section 5): plain fetch, no Node modules. Fetch goes through the guarded fetch
// (public addresses only, by what each hop resolves to; at most 5 redirects) and returns bounded readable text. Search reads DuckDuckGo's HTML
// results, as the CLI's search does without a key.
import { defineTool } from "@knightcode/durable";
import { obj, str } from "@knightcode/schema";
import { guardedFetch } from "../connectors/guarded-fetch.ts";

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 20_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "KnightCodeBots/1.0 (+https://bots.knightcode.dev)";


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
	if (!/^https?:\/\//i.test(url)) throw new Error("Only http and https addresses can be fetched.");
	// Every hop is checked by what the name resolves to, not only how it is spelled (connectors' guarded fetch).
	const response = await guardedFetch(
		url,
		{
			headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
		{ allowPrivate: [] },
	);
	const type = response.headers.get("content-type") ?? "";
	if (!/text|json|xml|javascript/.test(type) && type) {
		await response.body?.cancel();
		return { url: response.url || url, status: response.status, text: `(${type} content is not text)` };
	}
	const body = await readCapped(response);
	const html = /html/.test(type) || /^\s*</.test(body);
	const title = html ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] : undefined;
	const text = html ? htmlToText(body) : body;
	return {
		url: response.url || url,
		status: response.status,
		...(title ? { title: decodeEntities(title).trim() } : {}),
		text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}
…(truncated)` : text,
	};
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

/** `entered` runs when web text reaches the run: from then on the run carries the outside mark (spec section 24). */
export const webTools = (entered: () => Promise<void> = async () => {}) => {
	const outside = async <T>(result: T) => {
		await entered();
		return text(result);
	};
	return [
		defineTool({
			name: "web_search",
			description: "Search the web. Returns titles, links and snippets.",
			parameters: obj({ query: str() }),
			execute: async ({ query }) => webSearch(query).then(outside, failure),
		}),
		defineTool({
			name: "web_fetch",
			description: "Read a public web page as text (bounded).",
			parameters: obj({ url: str() }),
			execute: async ({ url }) => webFetch(url).then(outside, failure),
		}),
	];
};
