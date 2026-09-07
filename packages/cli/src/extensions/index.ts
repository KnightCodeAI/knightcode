import remoteExtension from "@knightcode/remote";
import type { InlineExtension } from "../core/extensions/types.ts";
import llamaExtension from "./llama/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
	// Hidden like llama.cpp: /remote is a built-in command, and listing it under
	// "Extensions" at startup advertises an implementation detail as an add-on.
	{ name: "remote", factory: remoteExtension, hidden: true },
];
