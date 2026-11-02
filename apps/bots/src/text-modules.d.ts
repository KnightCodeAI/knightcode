// Markdown files bundled as text (wrangler's Text rule).
declare module "*.md" {
	const text: string;
	export default text;
}
