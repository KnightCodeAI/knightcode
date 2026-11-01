/**
 * Wire format of gemini.google.com, reverse engineered from the web app. It is unofficial: Google can change it
 * without notice, so every reader here tolerates missing fields instead of assuming a shape.
 */

import { geminiWebModelSelector, geminiWebThinkingCode } from "./gemini-web-models.ts";

export const GEMINI_WEB_ORIGIN = "https://gemini.google.com";
export const GEMINI_WEB_INIT_URL = `${GEMINI_WEB_ORIGIN}/app`;
export const GEMINI_WEB_GENERATE_URL = `${GEMINI_WEB_ORIGIN}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;

const SESSION_COOKIE_NAMES = ["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC"] as const;
const STREAMING_FLAG_INDEX = 7;
const TEMPORARY_CHAT_FLAG_INDEX = 45;
const MODEL_MODE_INDEX = 79;
const THINKING_LEVEL_INDEX = 80;
const MODEL_SWITCHED_INDEX = 96;
const REQUEST_ARRAY_LENGTH = 99;
const MODEL_HEADER = "x-goog-ext-525001261-jspb";
/** Feature ids the signed-in web client repeats in the model header. */
const CLIENT_FEATURES = [4, 5, 6, 8, 16, 19, 20];
const NEW_CHAT_METADATA = ["", "", "", null, null, null, null, null, null, ""];
const CARD_CONTENT_RE = /^https?:\/\/googleusercontent\.com\/card_content\/\d+/;
const ARTIFACTS_RE = /https?:\/\/googleusercontent\.com\/(?:\w+\/)+\d+\n*/g;

export interface GeminiWebSession {
	accessToken: string;
	buildLabel?: string;
	sessionId?: string;
	language: string;
}

/**
 * Reduce a pasted credential to the `Cookie` header the web app needs. Accepts a bare `__Secure-1PSID` value or a
 * `name=value; name=value` string. Only the session cookies are kept: sending the rest of a browser's jar
 * hands over more of the account than the request needs.
 */
export function parseGeminiWebCookies(secret: string): string {
	const trimmed = secret.trim();
	if (!trimmed) throw new Error("Gemini web cookies are empty");
	if (!/(^|;)\s*__Secure-1PSID=/.test(trimmed)) {
		if (/[;\s]/.test(trimmed)) {
			throw new Error("Expected the __Secure-1PSID cookie value, or `__Secure-1PSID=...; __Secure-1PSIDTS=...`");
		}
		return `__Secure-1PSID=${trimmed}`;
	}
	const wanted = new Map<string, string>();
	for (const part of trimmed.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		const name = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (SESSION_COOKIE_NAMES.includes(name as (typeof SESSION_COOKIE_NAMES)[number]) && value) wanted.set(name, value);
	}
	if (!wanted.has("__Secure-1PSID")) throw new Error("The __Secure-1PSID cookie is missing or empty");
	return SESSION_COOKIE_NAMES.filter((name) => wanted.has(name))
		.map((name) => `${name}=${wanted.get(name)}`)
		.join("; ");
}

/** Safe read of a nested JSPB value; undefined when any step is missing or null. */
export function getNested(data: unknown, path: readonly (number | string)[]): unknown {
	let current = data;
	for (const key of path) {
		if (Array.isArray(current) && typeof key === "number") {
			const index = key < 0 ? current.length + key : key;
			if (index < 0 || index >= current.length) return undefined;
			current = current[index];
		} else if (current !== null && typeof current === "object" && !Array.isArray(current) && typeof key === "string") {
			current = (current as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
		if (current === undefined || current === null) return undefined;
	}
	return current;
}

/**
 * Incremental parser for the length-prefixed frames Google streams after an anti-XSSI prefix. A frame is a decimal
 * length followed by that many UTF-16 code units, which is exactly what a JS string length counts.
 */
export class GeminiWebFrameParser {
	private buffer = "";
	private prefixChecked = false;

	feed(chunk: string): unknown[] {
		this.buffer += chunk;
		if (!this.prefixChecked) {
			const prefix = ")]}'";
			if (this.buffer.length < prefix.length && prefix.startsWith(this.buffer)) return [];
			if (this.buffer.startsWith(prefix)) this.buffer = this.buffer.slice(prefix.length);
			this.prefixChecked = true;
		}

		const parts: unknown[] = [];
		for (;;) {
			this.buffer = this.buffer.trimStart();
			const marker = /^(\d+)\n/.exec(this.buffer);
			if (!marker) break;
			const digits = marker[1].length;
			const expected = Number.parseInt(marker[1], 10);
			if (this.buffer.length < digits + expected) break;
			const payload = this.buffer.slice(digits, digits + expected);
			this.buffer = this.buffer.slice(digits + expected);
			if (!payload.trim()) continue;
			try {
				const parsed: unknown = JSON.parse(payload);
				if (Array.isArray(parsed)) parts.push(...parsed);
				else parts.push(parsed);
			} catch {
				// A frame that is not JSON carries nothing we read; skip it rather than abort the stream.
			}
		}
		return parts;
	}
}

/** Read the page tokens a request needs. Undefined when the page has no access token, i.e. the cookies were rejected. */
export function parseGeminiWebInitPage(html: string): GeminiWebSession | undefined {
	const find = (key: string): string | undefined => new RegExp(`"${key}":\\s*"(.*?)"`).exec(html)?.[1];
	const accessToken = find("SNlM0e");
	if (!accessToken) return undefined;
	return {
		accessToken,
		buildLabel: find("cfb2h"),
		sessionId: find("FdrFJe"),
		language: find("TuX5cc") ?? "en",
	};
}

export interface GeminiWebRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
}

export interface BuildGeminiWebRequestInput {
	prompt: string;
	session: GeminiWebSession;
	reqId: number;
	requestUuid: string;
	modelId?: string;
	thinking?: {
		enabled?: boolean;
		level?: "low" | "medium" | "high";
	};
}

/**
 * Model header the signed-in web client sends with StreamGenerate. Slot 4 is the model hash, slot 7 is temporary
 * chat, slot 14 is the model mode, and slot 15 is the thinking code. Tier and timing are left unset: the page does
 * not expose them, and the web client already sends those slots empty on some requests.
 */
function buildGeminiWebModelHeader(input: {
	hash: string;
	mode: number;
	thinkingCode: number | undefined;
	requestUuid: string;
	buildLabel?: string;
}): string {
	return JSON.stringify([
		1,
		null,
		null,
		null,
		input.hash,
		null,
		null,
		1,
		[...CLIENT_FEATURES, ...CLIENT_FEATURES],
		null,
		null,
		null,
		null,
		null,
		input.mode,
		input.thinkingCode ?? null,
		input.requestUuid,
		input.buildLabel ? [input.buildLabel] : null,
		null,
		null,
	]);
}

/**
 * One StreamGenerate request on the selected model, as a temporary chat so nothing lands in the user's
 * Gemini history. Each call is a new chat: the caller sends the whole transcript in `prompt`.
 *
 * A known model id sets `f.req[79]` and the model header. `default` and unknown ids set neither, so Gemini uses
 * the account's selected model. Thinking is `f.req[80]` (low 1, medium 4, high 2), not a prompt instruction.
 */
export function buildGeminiWebRequest(input: BuildGeminiWebRequestInput): GeminiWebRequest {
	const { prompt, session, reqId, requestUuid, modelId, thinking } = input;
	const selector = geminiWebModelSelector(modelId);
	const thinkingCode = thinking?.enabled === false ? undefined : geminiWebThinkingCode(thinking?.level);
	const inner: unknown[] = new Array(REQUEST_ARRAY_LENGTH).fill(null);
	inner[0] = [prompt, 0, null, null, null, null, 0];
	inner[1] = [session.language];
	inner[2] = NEW_CHAT_METADATA;
	inner[6] = [1];
	inner[STREAMING_FLAG_INDEX] = 1;
	inner[10] = 1;
	inner[11] = 0;
	inner[17] = [[0]];
	inner[18] = 0;
	inner[27] = 1;
	inner[30] = [4];
	inner[41] = [1];
	inner[TEMPORARY_CHAT_FLAG_INDEX] = 1;
	inner[53] = 0;
	inner[59] = requestUuid;
	inner[61] = [];
	inner[68] = 1;
	inner[MODEL_MODE_INDEX] = selector?.mode ?? null;
	inner[THINKING_LEVEL_INDEX] = thinkingCode ?? null;
	inner[91] = 0;
	inner[MODEL_SWITCHED_INDEX] = selector ? 1 : 0;
	inner[98] = 1;

	const params = new URLSearchParams({ hl: session.language, _reqid: String(reqId), rt: "c" });
	if (session.buildLabel) params.set("bl", session.buildLabel);
	if (session.sessionId) params.set("f.sid", session.sessionId);

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
		Origin: GEMINI_WEB_ORIGIN,
		Referer: `${GEMINI_WEB_ORIGIN}/`,
		"x-goog-ext-525005358-jspb": `["${requestUuid}",1]`,
		"X-Same-Domain": "1",
	};
	if (selector) {
		headers["x-goog-ext-73010989-jspb"] = "[0]";
		headers["x-goog-ext-73010990-jspb"] = "[0,0,0]";
		headers[MODEL_HEADER] = buildGeminiWebModelHeader({
			hash: selector.hash,
			mode: selector.mode,
			thinkingCode,
			requestUuid,
			buildLabel: session.buildLabel,
		});
	}

	return {
		url: `${GEMINI_WEB_GENERATE_URL}?${params.toString()}`,
		headers,
		body: new URLSearchParams({
			at: session.accessToken,
			"f.req": JSON.stringify([null, JSON.stringify(inner)]),
		}).toString(),
	};
}

export interface GeminiWebFrameUpdate {
	/** Cumulative reply text so far. */
	text?: string;
	/** Cumulative thought summary so far. The web app does not return the hidden reasoning trace. */
	thinking?: string;
	/** True when Google marks the reply as finished. */
	completed: boolean;
	/** Set when the frame is a server-side error. */
	errorCode?: number;
	/** Hash of the model that actually answered. Absent when the frame does not name one. */
	modelHash?: string;
}

/** Read the first reply candidate of a response part. Undefined for parts that carry neither text nor an error. */
export function readGeminiWebFrame(part: unknown): GeminiWebFrameUpdate | undefined {
	const errorCode = getNested(part, [5, 2, 0, 1, 0]);
	if (typeof errorCode === "number") return { completed: false, errorCode };

	const innerJson = getNested(part, [2]);
	if (typeof innerJson !== "string") return undefined;
	let inner: unknown;
	try {
		inner = JSON.parse(innerJson);
	} catch {
		return undefined;
	}
	const candidate = getNested(inner, [4, 0]);
	if (!candidate) return undefined;

	let text = getNested(candidate, [1, 0]);
	const thinking = getNested(candidate, [37, 0, 0]);
	if (typeof text !== "string" && typeof thinking !== "string") return undefined;
	if (typeof text === "string" && CARD_CONTENT_RE.test(text)) {
		const card = getNested(candidate, [22, 0]);
		if (typeof card === "string") text = card;
	}
	const modelHash = getNested(inner, [39]);
	return {
		...(typeof text === "string" ? { text: text.replace(ARTIFACTS_RE, "") } : {}),
		...(typeof thinking === "string" ? { thinking } : {}),
		completed: getNested(candidate, [8, 0]) === 2,
		...(typeof modelHash === "string" && /^[0-9a-f]{16}$/.test(modelHash) ? { modelHash } : {}),
	};
}

/** The selected model was over its limit and Google answered with a different one. */
export function geminiWebQuotaMessage(modelName: string): string {
	return `${modelName} is over its quota. Gemini web did not answer with that model, so the reply was discarded. Wait for the limit to reset or choose another model.`;
}

/**
 * Drop the trailing markup Gemini emits and later rewrites mid-stream: a dangling code fence or a half-written
 * markdown escape. Only for unfinished text; the final frame is used as sent.
 */
export function cleanTransientText(text: string): string {
	return text.replace(/\n```$/, "").replace(/\\+[`*_~][^\n]*$/, "");
}

const ERROR_MESSAGES: Record<number, string> = {
	1013: "Gemini web hit a temporary error (1013). Try again.",
	1037: "Gemini web usage limit reached for this account. Wait for the limit to reset or use another provider.",
	1050: "Gemini web rejected the request as inconsistent with the conversation.",
	1052: "Gemini web rejected the model selector (1052). The unofficial model ids may have changed.",
	1060: "Google has temporarily blocked this network from Gemini web (1060).",
};

export function geminiWebErrorMessage(code: number): string {
	return ERROR_MESSAGES[code] ?? `Gemini web returned error code ${code}.`;
}
