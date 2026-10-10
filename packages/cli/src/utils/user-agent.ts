/** `knightcode/0.4.2 (win32; bun/1.3.3; x64)` — the shape `apps/web/app/api/report-install/route.ts` parses. */
export function getKnightcodeUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `knightcode/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
