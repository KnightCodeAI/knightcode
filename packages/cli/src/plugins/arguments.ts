/**
 * The argument dialect of plugin commands and skills, following Claude Code: arguments are split like a shell would
 * (quotes, backslash escapes), `$VAR` stays literal, shell operators are dropped, and placeholders are 0-indexed
 * (`$0`, `$ARGUMENTS[0]`), named (`$name` from the `arguments` frontmatter), or the whole string (`$ARGUMENTS`).
 * Grok Build splits on whitespace instead, so a quoted argument with spaces is one argument here and several there.
 *
 * KnightCode's own prompt templates keep their 1-indexed `$1`/`$@` rules (`core/prompt-templates.ts`).
 */

const OPERATORS = ["||", "&&", ";;", "|&", "<(", ">>", ">&", "|", "&", ";", "(", ")", "<", ">"];

/** Splits `input` into arguments. */
export function parsePluginArguments(input: string): string[] {
	const args: string[] = [];
	let current = "";
	let inArgument = false;
	const end = () => {
		if (inArgument) args.push(current);
		current = "";
		inArgument = false;
	};
	let index = 0;
	while (index < input.length) {
		const char = input[index]!;
		if (/\s/.test(char)) {
			end();
			index++;
			continue;
		}
		// A `#` that starts a word starts a comment.
		if (char === "#" && !inArgument) break;
		const operator = OPERATORS.find((candidate) => input.startsWith(candidate, index));
		if (operator) {
			end();
			index += operator.length;
			continue;
		}
		inArgument = true;
		if (char === "'") {
			const close = input.indexOf("'", index + 1);
			current += close === -1 ? input.slice(index + 1) : input.slice(index + 1, close);
			index = close === -1 ? input.length : close + 1;
		} else if (char === '"') {
			index++;
			while (index < input.length && input[index] !== '"') {
				if (input[index] === "\\" && /["\\$`]/.test(input[index + 1] ?? "")) index++;
				current += input[index];
				index++;
			}
			index++;
		} else if (char === "\\") {
			current += input[index + 1] ?? "";
			index += 2;
		} else {
			current += char;
			index++;
		}
	}
	end();
	return args;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fills the placeholders of `content` with `args`. Without any placeholder, non-empty arguments are appended as
 * `ARGUMENTS: <args>`.
 */
export function substitutePluginArguments(content: string, args: string, names: readonly string[]): string {
	const parsed = parsePluginArguments(args);
	// One pass, so an argument that itself reads like a placeholder is never expanded again.
	const placeholder = new RegExp(
		[
			...names.map((name) => `\\$${escapeRegExp(name)}(?![\\[\\w])`),
			"\\$ARGUMENTS\\[(\\d+)\\]",
			"\\$ARGUMENTS",
			"\\$(\\d+)(?!\\w)",
		].join("|"),
		"g",
	);
	let found = false;
	const result = content.replace(placeholder, (match, indexed?: string, positional?: string) => {
		found = true;
		const index = indexed ?? positional;
		if (index !== undefined) return parsed[Number(index)] ?? "";
		const named = names.indexOf(match.slice(1));
		return named === -1 ? args : (parsed[named] ?? "");
	});
	return found || !args ? result : `${result}\n\nARGUMENTS: ${args}`;
}
