// The help skill (spec section 5): answers questions about KnightCode Bots itself from apps/bots/docs/help/*.md. The
// documents are passed in, so this module runs anywhere; help-docs.ts loads the bundled ones.
import { defineTool } from "@knightcode/durable";
import { obj, opt, str } from "@knightcode/schema";

/** Topic name (the file's base name) to Markdown. */
export type HelpDocs = Record<string, string>;

export function helpTool(docs: HelpDocs) {
	const topics = Object.keys(docs).sort();
	return defineTool({
		name: "help",
		description: `How KnightCode Bots works, for questions about the product itself. Topics: ${topics.join(", ")}.`,
		deferred: true,
		parameters: obj({ topic: opt(str()) }),
		execute: async ({ topic }) => {
			const doc = topic ? docs[topic.toLowerCase().replace(/\.md$/, "")] : undefined;
			const text = doc ?? `Topics: ${topics.join(", ")}. Call help with one of them.`;
			return { output: [{ type: "text" as const, text }] };
		},
	});
}
