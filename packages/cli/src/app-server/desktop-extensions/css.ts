/** A deliberately bounded authored-CSS grammar with revision-owned roots and global-name isolation. */
import postcss from "postcss";

import { experimental_THEME_TOKENS as DESKTOP_THEME_TOKENS } from "../../desktop.ts";

interface CssOptions {
	owner: string;
	revision: string;
	asset?: (path: string) => string;
}

/** Reject unsafe or unsupported CSS rather than claiming to scope arbitrary selectors or value syntax. */
export function scopeDesktopCss(source: string, options: CssOptions): string {
	const root = postcss.parse(source);
	const prefix = `kc-${options.owner.replaceAll(".", "-")}-${options.revision}-`;
	const keyframes = new Map<string, string>();
	const properties = new Map<string, string>();
	const fontFamilies = new Map<string, string>();
	const ruleNames = new Map([
		["keyframes", keyframes],
		["property", properties],
		["layer", new Map<string, string>()],
	]);
	// CSS is a source trust boundary. Escape syntax complicates identifier/URL policy; unsupported forms fail closed.
	if (source.includes("\\"))
		throw new Error("CSS escapes are unsupported; use plain selectors and local assets (desktop-extensions §Styles).");
	root.walkComments((comment) => {
		comment.remove();
	});
	root.walkAtRules((rule) => {
		if (!["media", "supports", "container", "keyframes", "font-face", "property", "layer"].includes(rule.name)) {
			throw new Error(`Unsupported CSS @${rule.name}; use owned rules (desktop-extensions §Styles).`);
		}
	});
	root.walkAtRules((rule) => {
		const names = ruleNames.get(rule.name);
		if (names) {
			const name = rule.params.trim();
			if (!/^(?:--)?[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) || name.startsWith("--kc-"))
				throw new Error(`Unsupported or reserved CSS name: ${name}`);
			names.set(name, name.startsWith("--") ? `--${prefix}${name.slice(2)}` : `${prefix}${name}`);
		}
	});
	root.walkDecls((declaration) => {
		if (!declaration.prop.startsWith("--")) declaration.prop = declaration.prop.toLowerCase();
		if (declaration.prop.startsWith("--kc-"))
			throw new Error("Host --kc-* theme tokens are read-only; use an extension custom property.");
		if (declaration.prop.startsWith("--")) properties.set(declaration.prop, `--${prefix}${declaration.prop.slice(2)}`);
		if (
			declaration.parent?.type === "atrule" &&
			declaration.parent.name === "font-face" &&
			declaration.prop === "font-family"
		) {
			const name = declaration.value.replace(/^["']|["']$/g, "");
			if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name))
				throw new Error("Extension font-family names must be single identifiers.");
			fontFamilies.set(name.toLowerCase(), `${prefix}${name}`);
		}
	});
	root.walkRules((rule) => {
		if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") {
			if (!/^(?:(?:from|to|[\d.]+%)(?:\s*,\s*)?)+$/.test(rule.selector))
				throw new Error("Unsupported keyframe selector.");
			return;
		}
		if (rule.parent?.type === "rule") throw new Error("CSS nesting is unsupported; write complete owned selectors.");
		for (const selector of rule.selectors) {
			// No relational pseudos, sibling escapes, owner selectors, global roots or arbitrary functional selectors.
			if (
				/[+~&\\()@]/.test(selector) ||
				/(?:^|[\s>])(?:html|body)(?:$|[\s>.:#\[])/i.test(selector) ||
				/:root|data-kc-|::?slotted|::?part/i.test(selector)
			)
				throw new Error(
					`Unsafe CSS selector ${selector}; style :scope or owned descendants (desktop-extensions §Styles).`,
				);
			if (selector.includes("*") && !selector.startsWith(":scope "))
				throw new Error("Universal CSS selectors must start with ':scope '.");
			if (!/^[a-zA-Z0-9_.#:\[\]="'\-\s>*|]+$/.test(selector) || selector.startsWith(">") || selector.startsWith("|"))
				throw new Error(`Unsupported CSS selector: ${selector}`);
		}
	});
	root.walkAtRules((rule) => {
		rule.params = ruleNames.get(rule.name)?.get(rule.params.trim()) ?? rule.params;
	});
	root.walkDecls((declaration) => {
		declaration.prop = properties.get(declaration.prop) ?? declaration.prop;
		if (
			/expression\s*\(|(?:image-set|src|paint)\s*\(/i.test(declaration.value) ||
			/-moz-binding|behavior/i.test(declaration.prop)
		)
			throw new Error("Unsupported CSS executable or resource value.");
		let value = declaration.value.replace(
			/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s()"']+))\s*\)/gi,
			(_all, double: string | undefined, single: string | undefined, plain: string | undefined) => {
				const path = double ?? single ?? plain!;
				if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(path) || /[?#]/.test(path) || !options.asset)
					throw new Error(`CSS URL must name a staged local asset: ${path}`);
				return `url("${options.asset(path)}")`;
			},
		);
		if (/url\s*\(/i.test(value.replace(/url\("app:\/\/ext\/[^"\n]+"\)/g, "")))
			throw new Error("Unsupported CSS url() syntax.");
		value = value.replace(/"[^"]*"|'[^']*'|--[a-zA-Z_][a-zA-Z0-9_-]*/g, (name) => {
			if (name.startsWith('"') || name.startsWith("'")) return name;
			if (name.startsWith("--kc-") && !DESKTOP_THEME_TOKENS.some((token) => token === name))
				throw new Error(`Unpublished host theme token: ${name}`);
			return properties.get(name) ?? (name.startsWith("--kc-") ? name : `--${prefix}${name.slice(2)}`);
		});
		const names = /^(?:animation|animation-name)$/.test(declaration.prop)
			? keyframes
			: /^(?:font|font-family)$/.test(declaration.prop)
				? fontFamilies
				: undefined;
		if (names) {
			value = value.replace(/"[^"]*"|'[^']*'|(?<![a-zA-Z0-9_-])[a-zA-Z_][a-zA-Z0-9_-]*/g, (token, offset: number) => {
				const quote = token.startsWith('"') || token.startsWith("'") ? token[0]! : "";
				if (
					!quote &&
					value
						.slice(offset + token.length)
						.trimStart()
						.startsWith("(")
				)
					return token;
				const name = quote ? token.slice(1, -1) : token;
				const replacement = names.get(names === fontFamilies ? name.toLowerCase() : name);
				return replacement ? `${quote}${replacement}${quote}` : token;
			});
		}
		declaration.value = value;
	});
	return wrapDesktopCss(root.toString(), options.owner, options.revision);
}

/** Scope includes the owned root and stops before every foreign owner or revision, including a nested root. */
function wrapDesktopCss(css: string, owner: string, revision: string): string {
	const owned = `[data-kc-owner="${owner}"][data-kc-revision="${revision}"]`;
	return `@scope (${owned}) to ([data-kc-owner]:not(${owned})) {\n${css}\n}`;
}
