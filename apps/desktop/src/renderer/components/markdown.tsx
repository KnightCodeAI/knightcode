/**
 * GFM rendered from marked's tokens straight to React: no HTML string, so raw HTML in a reply
 * shows as text (desktop-shell.md section 6.3).
 */

import { Check, Copy } from "lucide-react";
import { lexer, type Token, type Tokens } from "marked";
import { type ReactNode, useMemo, useState } from "react";
import { client } from "../client.ts";

function openLink(href: string): void {
	void client.host("host/shell/openExternal", { url: href }).catch(() => {});
}

function inline(tokens: Token[] | undefined, fallback = ""): ReactNode[] {
	if (!tokens) return [fallback];
	return tokens.map((token, i) => {
		switch (token.type) {
			case "strong":
				return (
					<strong key={i} className="font-semibold">
						{inline((token as Tokens.Strong).tokens)}
					</strong>
				);
			case "em":
				return <em key={i}>{inline((token as Tokens.Em).tokens)}</em>;
			case "del":
				return <del key={i}>{inline((token as Tokens.Del).tokens)}</del>;
			case "codespan":
				return (
					<code key={i} className="rounded bg-hover px-1 py-px font-code text-[0.92em]">
						{(token as Tokens.Codespan).text}
					</code>
				);
			case "link": {
				const link = token as Tokens.Link;
				return (
					<a
						key={i}
						href={link.href}
						title={link.href}
						className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
						onClick={(event) => {
							event.preventDefault();
							openLink(link.href);
						}}
					>
						{inline(link.tokens)}
					</a>
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

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="group/code my-3 overflow-hidden rounded-[var(--kc-radius)] border border-line bg-shell">
			<div className="flex h-7 items-center justify-between border-b border-line px-3 text-[11px] text-faint">
				<span>{lang || "text"}</span>
				<button
					type="button"
					className="flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-ink"
					onClick={() => {
						void client.host("host/clipboard/writeText", { text: code });
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? <Check size={12} /> : <Copy size={12} />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre className="selectable overflow-x-auto p-3 font-code text-[length:var(--kc-size-code)] leading-relaxed">
				<code>{code}</code>
			</pre>
		</div>
	);
}

function blocks(tokens: Token[]): ReactNode[] {
	return tokens.map((token, i) => {
		switch (token.type) {
			case "heading": {
				const heading = token as Tokens.Heading;
				const size = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-sm"][heading.depth - 1];
				return (
					<p key={i} className={`mt-5 mb-2 font-semibold ${size}`}>
						{inline(heading.tokens)}
					</p>
				);
			}
			case "paragraph":
				return (
					<p key={i} className="my-2.5">
						{inline((token as Tokens.Paragraph).tokens)}
					</p>
				);
			case "code": {
				const code = token as Tokens.Code;
				return <CodeBlock key={i} code={code.text} lang={code.lang} />;
			}
			case "blockquote":
				return (
					<blockquote key={i} className="my-3 border-l-2 border-line-strong pl-3 text-muted">
						{blocks((token as Tokens.Blockquote).tokens)}
					</blockquote>
				);
			case "list": {
				const list = token as Tokens.List;
				const Tag = list.ordered ? "ol" : "ul";
				return (
					<Tag key={i} className={`my-2.5 pl-5 ${list.ordered ? "list-decimal" : "list-disc"} marker:text-faint`}>
						{list.items.map((item, j) => (
							<li key={j} className="my-1 pl-1">
								{item.task ? (
									<input type="checkbox" checked={item.checked} readOnly className="mr-1.5 align-middle" />
								) : null}
								{item.loose
									? blocks(item.tokens)
									: inline(item.tokens.flatMap((t) => ("tokens" in t && t.type === "text" ? (t.tokens ?? [t]) : [t])))}
							</li>
						))}
					</Tag>
				);
			}
			case "table": {
				const table = token as Tokens.Table;
				return (
					<div key={i} className="my-3 overflow-x-auto">
						<table className="border-collapse text-left">
							<thead>
								<tr>
									{table.header.map((cell, j) => (
										<th key={j} className="border border-line px-2.5 py-1.5 font-semibold">
											{inline(cell.tokens)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{table.rows.map((row, j) => (
									<tr key={j}>
										{row.map((cell, k) => (
											<td key={k} className="border border-line px-2.5 py-1.5">
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
				return <hr key={i} className="my-4 border-line" />;
			case "space":
				return null;
			default:
				return "tokens" in token && token.tokens ? (
					<p key={i} className="my-2.5">
						{inline(token.tokens)}
					</p>
				) : (
					<p key={i} className="my-2.5 whitespace-pre-wrap">
						{"raw" in token ? token.raw : ""}
					</p>
				);
		}
	});
}

export function Markdown({ text }: { text: string }) {
	const tokens = useMemo(() => lexer(text, { gfm: true }), [text]);
	return <div className="markdown selectable leading-relaxed">{blocks(tokens)}</div>;
}
