import TurndownService from "turndown";

const JUNK_TAGS = [
	"head",
	"title",
	"script",
	"style",
	"noscript",
	"nav",
	"header",
	"footer",
	"aside",
	"svg",
	"iframe",
	"form",
	"template",
];

let turndown: TurndownService | undefined;

function service(): TurndownService {
	if (!turndown) {
		turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
		turndown.remove(JUNK_TAGS as Parameters<TurndownService["remove"]>[0]);
	}
	return turndown;
}

/**
 * Returns the part of the page worth converting: the longest <main> or <article>, else <body>,
 * else the input. A tag scan with a nesting stack, so an <article> inside an <article> closes
 * the inner one, not the outer. ponytail: not a readability port — good enough for docs and
 * articles, and it needs no DOM library in the binary.
 */
export function pickMainContent(html: string): string {
	let best: string | undefined;
	const open: Array<{ tag: string; start: number }> = [];
	for (const match of html.matchAll(/<(\/?)(main|article)\b[^>]*>/gi)) {
		const tag = match[2].toLowerCase();
		if (!match[1]) {
			open.push({ tag, start: match.index + match[0].length });
			continue;
		}
		const depth = open.findLastIndex((entry) => entry.tag === tag);
		if (depth === -1) continue;
		const inner = html.slice(open[depth].start, match.index);
		open.length = depth;
		if (best === undefined || inner.length > best.length) best = inner;
	}
	if (best !== undefined) return best;
	const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
	return body ? body[1] : html;
}

export function htmlToMarkdown(html: string): string {
	return service()
		.turndown(html)
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
		const lower = entity.toLowerCase();
		switch (lower) {
			case "amp":
				return "&";
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "quot":
				return '"';
			case "apos":
				return "'";
			case "nbsp":
				return " ";
		}
		const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
		// fromCodePoint throws past U+10FFFF; leave such an entity as written, like an unknown name.
		return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

export function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

export function extractTitle(html: string): string | undefined {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	if (!match) return undefined;
	const title = stripTags(match[1]);
	return title || undefined;
}

function bareType(contentType: string): string {
	return contentType.split(";")[0].trim().toLowerCase();
}

export function isTextContentType(contentType: string): boolean {
	const type = bareType(contentType);
	return type.startsWith("text/") || /[/+](json|xml|javascript|ecmascript|yaml|x-yaml|toml|x-sh)$/.test(type);
}

export function isHtmlContentType(contentType: string): boolean {
	const type = bareType(contentType);
	return type === "text/html" || type === "application/xhtml+xml";
}
