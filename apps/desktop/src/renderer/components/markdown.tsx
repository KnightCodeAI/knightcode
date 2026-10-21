/**
 * GFM rendered from marked's tokens straight to React: no HTML string, so raw HTML in a reply
 * shows as text (desktop-shell.md section 6.3). The look is Codex's, in styles.css (.kc-markdown); code blocks are
 * Codex's card with the language, word wrap and copy, coloured as Codex colours them: highlight.js through lowlight,
 * whose syntax tree renders as React spans (no HTML here either), in Codex's palette (styles.css, .hljs-*).
 */

import type { RootContent } from "hast";
import { all, createLowlight } from "lowlight";
import { lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { client } from "../client.ts";
import { IconButton } from "./button.tsx";
import { Check, Code, Copy, WrapText } from "./icons.tsx";
import { Tooltip } from "./tooltip.tsx";

function openLink(href: string): void {
	void client.host("host/shell/openExternal", { url: href }).catch(() => {});
}

function inline(tokens: Token[] | undefined, fallback = ""): ReactNode[] {
	if (!tokens) return [fallback];
	return tokens.map((token, i) => {
		switch (token.type) {
			case "strong":
				return <strong key={i}>{inline((token as Tokens.Strong).tokens)}</strong>;
			case "em":
				return <em key={i}>{inline((token as Tokens.Em).tokens)}</em>;
			case "del":
				return <del key={i}>{inline((token as Tokens.Del).tokens)}</del>;
			case "codespan":
				return <code key={i}>{unescape((token as Tokens.Codespan).text)}</code>;
			case "link": {
				const link = token as Tokens.Link;
				return (
					<Tooltip key={i} content={link.href}>
						<a
							href={link.href}
							onClick={(event) => {
								event.preventDefault();
								openLink(link.href);
							}}
						>
							{inline(link.tokens)}
						</a>
					</Tooltip>
				);
			}
			case "br":
				return <br key={i} />;
			case "text": {
				const text = token as Tokens.Text;
				return text.tokens ? <span key={i}>{inline(text.tokens)}</span> : unescape(text.text);
			}
			case "escape":
				return (token as Tokens.Escape).text;
			default:
				return "raw" in token ? token.raw : "";
		}
	});
}

const unescape = (text: string) =>
	text.replace(
		/&(amp|lt|gt|quot|#39);/g,
		(_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!,
	);

/** A fence's language as Codex names it in the code block header. */
const LANGUAGES: Record<string, string> = {
	js: "JavaScript",
	javascript: "JavaScript",
	jsx: "JavaScript",
	ts: "TypeScript",
	typescript: "TypeScript",
	tsx: "TypeScript",
	py: "Python",
	python: "Python",
	rs: "Rust",
	rust: "Rust",
	go: "Go",
	json: "JSON",
	md: "Markdown",
	markdown: "Markdown",
	css: "CSS",
	html: "HTML",
	sh: "Shell",
	bash: "Bash",
	shell: "Shell",
	powershell: "PowerShell",
	ps1: "PowerShell",
	yaml: "YAML",
	yml: "YAML",
	diff: "Diff",
};

/** Every highlight.js language and its aliases, as Codex registers them. */
const lowlight = createLowlight(all);

/** A highlighted tree as React: each token a span with its hljs class, text as text. */
function syntax(nodes: RootContent[]): ReactNode[] {
	return nodes.map((node, i) => {
		if (node.type === "text") return node.value;
		if (node.type !== "element") return null;
		const className = node.properties.className;
		return (
			<span key={i} className={Array.isArray(className) ? className.join(" ") : undefined}>
				{syntax(node.children)}
			</span>
		);
	});
}

/**
 * Codex's code block: a 20px-cornered card, a 20px code mark and the language at 13px medium, word wrap and copy as
 * 36px round buttons.
 */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
	const [copied, setCopied] = useState(false);
	const [wrap, setWrap] = useState(false);
	const known = lang ? LANGUAGES[lang.toLowerCase()] : undefined;
	// A fence without a language, or one highlight.js lacks, stays plain.
	const highlighted = useMemo(() => {
		const name = lang?.toLowerCase();
		return name && lowlight.registered(name) ? syntax(lowlight.highlight(name, code).children) : undefined;
	}, [code, lang]);
	return (
		<div className="kc-md-code overflow-hidden rounded-2xl border border-line-subtle bg-surface">
			<div className="flex h-12 items-center gap-2 ps-5 pe-1.5">
				<Code size={20} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{known ?? (lang || "Text")}</span>
				<IconButton
					label={wrap ? "Disable word wrap" : "Enable word wrap"}
					size="xl"
					round
					aria-pressed={wrap}
					onClick={() => setWrap(!wrap)}
				>
					<WrapText size={16} />
				</IconButton>
				<IconButton
					label={copied ? "Copied" : "Copy code"}
					size="xl"
					round
					onClick={() => {
						void client.host("host/clipboard/writeText", { text: code });
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? <Check size={16} /> : <Copy size={16} />}
				</IconButton>
			</div>
			<pre
				className={`selectable px-5 pb-3 font-code text-code ${wrap ? "break-words whitespace-pre-wrap" : "overflow-x-auto"}`}
			>
				<code>{highlighted ?? code}</code>
			</pre>
		</div>
	);
}

function blocks(tokens: Token[]): ReactNode[] {
	return tokens.map((token, i) => {
		switch (token.type) {
			case "heading": {
				const heading = token as Tokens.Heading;
				const Tag = `h${Math.min(heading.depth, 6)}` as "h1";
				return <Tag key={i}>{inline(heading.tokens)}</Tag>;
			}
			case "paragraph":
				return <p key={i}>{inline((token as Tokens.Paragraph).tokens)}</p>;
			case "code": {
				const code = token as Tokens.Code;
				return <CodeBlock key={i} code={code.text} lang={code.lang} />;
			}
			case "blockquote":
				return <blockquote key={i}>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
			case "list": {
				const list = token as Tokens.List;
				const Tag = list.ordered ? "ol" : "ul";
				return (
					<Tag
						key={i}
						start={list.ordered && typeof list.start === "number" && list.start !== 1 ? list.start : undefined}
					>
						{list.items.map((item, j) => (
							<li key={j}>
								{item.task ? <input type="checkbox" checked={item.checked} readOnly /> : null}
								{item.loose
									? blocks(item.tokens)
									: item.tokens.map((t, k) =>
											t.type === "list" ? (
												<Fragment key={k}>{blocks([t])}</Fragment>
											) : (
												<span key={k}>{inline("tokens" in t && t.type === "text" ? (t.tokens ?? [t]) : [t])}</span>
											),
										)}
							</li>
						))}
					</Tag>
				);
			}
			case "table": {
				const table = token as Tokens.Table;
				return (
					<div key={i} className="kc-md-table">
						<table>
							<thead>
								<tr>
									{table.header.map((cell, j) => (
										<th key={j} align={cell.align ?? undefined}>
											{inline(cell.tokens)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{table.rows.map((row, j) => (
									<tr key={j}>
										{row.map((cell, k) => (
											<td key={k} align={cell.align ?? undefined}>
												{inline(cell.tokens)}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				);
			}
			case "hr":
				return <hr key={i} />;
			case "space":
				return null;
			default:
				return "tokens" in token && token.tokens ? (
					<p key={i}>{inline(token.tokens)}</p>
				) : (
					<p key={i} className="whitespace-pre-wrap">
						{"raw" in token ? token.raw : ""}
					</p>
				);
		}
	});
}

/**  is the user's own message in its bubble: no space around its paragraphs, its colours inherited. */
export function Markdown({ text, tone }: { text: string; tone?: "user" }) {
	const tokens = useMemo(() => lexer(text, { gfm: true }), [text]);
	return (
		<div className="kc-markdown selectable" data-tone={tone}>
			{blocks(tokens)}
		</div>
	);
}
