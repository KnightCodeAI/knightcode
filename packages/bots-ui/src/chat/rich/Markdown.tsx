// Markdown to React elements. Uses marked's lexer only: nothing is ever injected as HTML, and raw HTML in the
// source is shown as text.
import { type Token, type Tokens, lexer } from "marked";
import { type ReactNode, useMemo } from "react";

export interface MarkdownProps {
	text: string;
	className?: string;
}

/** Renders `text` as prose. */
export function Markdown({ text, className }: MarkdownProps) {
	const tokens = useMemo(() => lexer(text, { gfm: true, breaks: false }), [text]);
	return <div className={className}>{blocks(tokens)}</div>;
}

function blocks(tokens: Token[]): ReactNode[] {
	return tokens.map((token, i) => block(token, i)).filter((node) => node !== null);
}

function block(token: Token, key: number): ReactNode {
	switch (token.type) {
		case "paragraph":
			return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
		case "heading": {
			const heading = token as Tokens.Heading;
			const Tag = `h${Math.min(6, Math.max(1, heading.depth))}` as "h1";
			return <Tag key={key}>{inline(heading.tokens)}</Tag>;
		}
		case "list": {
			const list = token as Tokens.List;
			const items = list.items.map((item, i) => (
				<li key={i}>
					{item.task && <input type="checkbox" checked={Boolean(item.checked)} disabled readOnly />}
					{item.tokens.length === 1 && item.tokens[0]?.type === "text"
						? inline((item.tokens[0] as Tokens.Text).tokens ?? [item.tokens[0]])
						: blocks(item.tokens)}
				</li>
			));
			return list.ordered ? (
				<ol key={key} start={typeof list.start === "number" ? list.start : undefined}>
					{items}
				</ol>
			) : (
				<ul key={key}>{items}</ul>
			);
		}
		case "blockquote":
			return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
		case "code":
			return (
				<pre key={key}>
					<code>{(token as Tokens.Code).text}</code>
				</pre>
			);
		case "table": {
			const table = token as Tokens.Table;
			return (
				<table key={key}>
					<thead>
						<tr>
							{table.header.map((cell, i) => (
								<th key={i}>{inline(cell.tokens)}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{table.rows.map((row, r) => (
							<tr key={r}>
								{row.map((cell, i) => (
									<td key={i}>{inline(cell.tokens)}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			);
		}
		case "hr":
			return <hr key={key} />;
		case "space":
			return null;
		case "text": {
			const text = token as Tokens.Text;
			return <p key={key}>{text.tokens ? inline(text.tokens) : text.text}</p>;
		}
		default:
			// html and anything unknown: its source, as text.
			return <p key={key}>{"raw" in token ? token.raw : ""}</p>;
	}
}

function inline(tokens: Token[] | undefined): ReactNode[] {
	return (tokens ?? []).map((token, key) => {
		switch (token.type) {
			case "strong":
				return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
			case "em":
				return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
			case "del":
				return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
			case "codespan":
				return <code key={key}>{decode((token as Tokens.Codespan).text)}</code>;
			case "br":
				return <br key={key} />;
			case "link": {
				const link = token as Tokens.Link;
				return safeHref(link.href) ? (
					<a key={key} href={link.href} target="_blank" rel="noreferrer noopener">
						{inline(link.tokens)}
					</a>
				) : (
					<span key={key}>{inline(link.tokens)}</span>
				);
			}
			case "text": {
				const text = token as Tokens.Text;
				return text.tokens ? <span key={key}>{inline(text.tokens)}</span> : decode(text.text);
			}
			case "escape":
				return (token as Tokens.Escape).text;
			default:
				return "raw" in token ? token.raw : "";
		}
	});
}

/** Only web and mail links open; `javascript:` and data URLs never do. */
export function safeHref(href: string): boolean {
	return /^(https?:|mailto:)/i.test(href.trim());
}

// marked escapes these in text tokens; React escapes again, so undo marked's pass.
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
function decode(text: string): string {
	return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}
