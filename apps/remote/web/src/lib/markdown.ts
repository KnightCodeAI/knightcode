export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * Minimal markdown: fenced code, inline code, bold, and paragraph breaks. Escaping runs
 * first and every tag emitted below is a literal, so transcript content cannot inject HTML.
 * That is what makes the dangerouslySetInnerHTML in the transcript safe — keep the order.
 */
export function renderMarkdown(source: string): string {
	const escaped = escapeHtml(source);
	return escaped
		.replace(/```([\s\S]*?)```/g, (_match, code: string) => `<pre><code>${code.trim()}</code></pre>`)
		.replace(/`([^`\n]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\n{2,}/g, "</p><p>");
}
