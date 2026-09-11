/**
 * ACP prompt blocks to the text-plus-images shape the engine's prompt route
 * takes. Pure.
 */

import { fileURLToPath } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ImageContent } from "@knightcode/ai";
import type { PromptInput } from "../sessions.ts";

/** A file: URI becomes a path the read tool can follow; anything else stays a URI. */
function uriToPath(uri: string): string {
	try {
		const url = new URL(uri);
		if (url.protocol === "file:") return fileURLToPath(url);
	} catch {
		// Not a URL at all; hand it to the model as written.
	}
	return uri;
}

export function toPromptInput(blocks: readonly ContentBlock[]): PromptInput {
	const parts: string[] = [];
	const images: ImageContent[] = [];
	for (const block of blocks) {
		switch (block.type) {
			case "text":
				parts.push(block.text);
				break;
			case "image":
				images.push({ type: "image", data: block.data, mimeType: block.mimeType });
				break;
			case "resource_link":
				parts.push(uriToPath(block.uri));
				break;
			case "resource":
				// Labelled so the model knows what it is looking at; a blob has no text to show.
				if ("text" in block.resource) parts.push(`[${uriToPath(block.resource.uri)}]\n${block.resource.text}`);
				break;
			default:
				// Audio has nowhere to go.
				break;
		}
	}
	return { text: parts.join("\n"), ...(images.length > 0 ? { images } : {}) };
}
