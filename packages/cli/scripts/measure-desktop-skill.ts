/** Measure prompt-listing bytes and the runtime's chars/4 token estimate, without provider calls. */
import { join } from "node:path";
import { getDocsPath } from "../src/config.ts";
import { formatSkillsForPrompt, loadSkillsFromDir } from "../src/core/skills.ts";

const { skills, diagnostics } = loadSkillsFromDir({
	dir: join(getDocsPath(), "desktop-customization"),
	source: "builtin",
});
if (skills.length !== 1 || diagnostics.length) throw new Error("Desktop customization skill did not load cleanly.");
const listing = formatSkillsForPrompt(skills);
const entry = listing.slice(listing.indexOf("  <skill>"), listing.indexOf("</available_skills>"));
console.log(
	JSON.stringify(
		{
			path: skills[0]!.filePath,
			entryCharacters: entry.length,
			entryEstimatedTokens: Math.ceil(entry.length / 4),
			firstSkillListingCharacters: listing.length,
			firstSkillListingEstimatedTokens: Math.ceil(listing.length / 4),
			nonDesktopAddedTokens: 0,
			method: "Measured formatted listing; chars/4 is KnightCode's estimate, not a model-specific tokenizer.",
		},
		null,
		2,
	),
);
