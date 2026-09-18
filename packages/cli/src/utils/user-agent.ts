/**
 * `knightcode/0.4.2 (win32; bun/1.3.3; x64)` — the shape
 * `apps/web/app/api/report-install/route.ts` parses. The product name is the
 * only part that varies: the CLI is `knightcode`, the IDE's engine is
 * `knightcode-ide`, and the route tells the two apart by it.
 */
export function getProductUserAgent(product: string, version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `${product}/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

export function getKnightcodeUserAgent(version: string): string {
	return getProductUserAgent("knightcode", version);
}
