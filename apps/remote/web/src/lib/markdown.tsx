import { lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode, useMemo } from "react";
import { cn } from "./utils.ts";

/**
 * Markdown to React elements, never to HTML. marked only lexes; every tag below is a literal
 * element, raw HTML tokens render as visible text, and links keep only web hrefs. That is
 * what lets transcript content — which the model wrote — land in the page safely.
 */

const SAFE_HREF = /^(https?:|mailto:)/i;

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };

/** marked pre-escapes a few token kinds for its HTML renderer; React needs the plain text back. */
function unescape(text: string): string {
	return text.replace(/&(?:lt|gt|amp|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

type WithTokens = { tokens?: Token[] };

function inline(token: Token & WithTokens, fallback: string): ReactNode {
	return token.tokens ? render(token.tokens) : fallback;
}

function render(tokens: readonly Token[]): ReactNode[] {
	return tokens.map((token, index) => renderToken(token, index));
}

function renderToken(token: Token, key: number): ReactNode {
	switch (token.type) {
		case "space":
		case "def":
			return null;
		case "heading": {
			const heading = token as Tokens.Heading;
			const Tag = `h${Math.min(heading.depth, 4)}` as "h1" | "h2" | "h3" | "h4";
			return <Tag key={key}>{render(heading.tokens)}</Tag>;
		}
		case "paragraph":
			return <p key={key}>{render((token as Tokens.Paragraph).tokens)}</p>;
		case "text": {
			const text = token as Tokens.Text & { escaped?: boolean };
			return <Fragment key={key}>{inline(text, text.escaped ? unescape(text.text) : text.text)}</Fragment>;
		}
		case "escape":
			return <Fragment key={key}>{unescape((token as Tokens.Escape).text)}</Fragment>;
		case "strong":
			return <strong key={key}>{render((token as Tokens.Strong).tokens)}</strong>;
		case "em":
			return <em key={key}>{render((token as Tokens.Em).tokens)}</em>;
		case "del":
			return <del key={key}>{render((token as Tokens.Del).tokens)}</del>;
		case "br":
			return <br key={key} />;
		case "codespan":
			return <code key={key}>{unescape((token as Tokens.Codespan).text)}</code>;
		case "code": {
			const code = token as Tokens.Code;
			return (
				<pre key={key} data-lang={code.lang || undefined}>
					<code>{code.text}</code>
				</pre>
			);
		}
		case "blockquote":
			return <blockquote key={key}>{render((token as Tokens.Blockquote).tokens)}</blockquote>;
		case "hr":
			return <hr key={key} />;
		case "list": {
			const list = token as Tokens.List;
			const Tag = list.ordered ? "ol" : "ul";
			const start = list.ordered && list.start !== "" && Number(list.start) !== 1 ? Number(list.start) : undefined;
			return (
				<Tag key={key} start={start}>
					{list.items.map((item, index) => (
						<li key={index}>
							{item.task ? <input type="checkbox" checked={item.checked === true} readOnly /> : null}
							{render(item.tokens)}
						</li>
					))}
				</Tag>
			);
		}
		case "link": {
			const link = token as Tokens.Link;
			const children = render(link.tokens);
			if (!SAFE_HREF.test(link.href)) return <Fragment key={key}>{children}</Fragment>;
			return (
				<a key={key} href={link.href} target="_blank" rel="noopener noreferrer">
					{children}
				</a>
			);
		}
		case "image":
			// Images are never mirrored; the alt text is all there is.
			return <Fragment key={key}>{(token as Tokens.Image).text}</Fragment>;
		case "html":
			return <Fragment key={key}>{(token as Tokens.HTML).text}</Fragment>;
		case "table": {
			const table = token as Tokens.Table;
			return (
				<div key={key} className="table-wrap">
					<table>
						<thead>
							<tr>
								{table.header.map((cell, index) => (
									<th key={index} style={cell.align ? { textAlign: cell.align } : undefined}>
										{render(cell.tokens)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{table.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, index) => (
										<td key={index} style={cell.align ? { textAlign: cell.align } : undefined}>
											{render(cell.tokens)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
		default:
			return <Fragment key={key}>{(token as { raw?: string }).raw ?? ""}</Fragment>;
	}
}

export function Markdown({ text, className }: { text: string; className?: string }): React.JSX.Element {
	const nodes = useMemo(() => render(lexer(text)), [text]);
	return <div className={cn("md", className)}>{nodes}</div>;
}
