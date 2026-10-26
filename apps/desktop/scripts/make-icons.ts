/**
 * The app's icons for the makers (desktop-shell.md section 15), from the website's 1024px icon: `assets/icon.ico`
 * (Windows: the installer and the executable), `assets/icon.icns` (macOS) and `assets/icon.png` (Linux, 512px). Both
 * containers hold PNG images, which Windows Vista and later and macOS 10.7 and later read. The website's icon is a
 * square; every output is cut to a rounded one. The outputs are committed; run again only when the icon changes:
 *
 *   bun run apps/desktop/scripts/make-icons.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const DESKTOP = join(import.meta.dir, "..");
const SOURCE = join(DESKTOP, "../web/public/knightcode-icon.png");
const OUT = join(DESKTOP, "assets");

// macOS draws app icons inside Apple's grid: an 824px shape centred on the 1024px canvas. A full-bleed icon would
// stand larger than every other app in the Dock.
const MAC_GRID = 824 / 1024;

/** A superellipse, |x|^5 + |y|^5 = 1: the continuous-corner shape of macOS app icons, filling a `size` box. */
function squircle(size: number): string {
	const r = size / 2;
	const points = Array.from({ length: 720 }, (_, i) => {
		const t = (i / 720) * 2 * Math.PI;
		const [c, s] = [Math.cos(t), Math.sin(t)];
		return `${(r + r * Math.sign(c) * Math.abs(c) ** 0.4).toFixed(2)},${(r + r * Math.sign(s) * Math.abs(s) ** 0.4).toFixed(2)}`;
	});
	return `M${points.join("L")}Z`;
}

const svg = (size: number, body: string) =>
	Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);

/**
 * The icon at `size`, its shape `grid` of the canvas wide and centred on transparency. A faint inner rim keeps the
 * black shape's edge visible on a dark taskbar or Dock.
 */
async function png(size: number, grid = 1): Promise<Buffer> {
	const inner = Math.round(size * grid);
	const path = squircle(inner);
	const shape = await sharp(SOURCE)
		.resize(inner, inner)
		.composite([
			{
				input: svg(
					inner,
					`<path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="${inner / 200}"/>`,
				),
			},
			{ input: svg(inner, `<path d="${path}" fill="#fff"/>`), blend: "dest-in" },
		])
		.png()
		.toBuffer();
	const start = Math.floor((size - inner) / 2);
	const end = size - inner - start;
	return sharp(shape)
		.extend({ top: start, bottom: end, left: start, right: end, background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
}

/** ICONDIR, then one 16-byte entry per image, then the PNGs (a 256px image's width and height are written as 0). */
async function ico(sizes: number[]): Promise<Buffer> {
	const images = await Promise.all(sizes.map((size) => png(size)));
	const header = Buffer.alloc(6 + 16 * sizes.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(sizes.length, 4);
	let offset = header.length;
	sizes.forEach((size, i) => {
		const entry = 6 + 16 * i;
		header.writeUInt8(size >= 256 ? 0 : size, entry);
		header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(images[i]!.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += images[i]!.length;
	});
	return Buffer.concat([header, ...images]);
}

/** `icns`, its length, then one chunk per image: its type, its length with the 8-byte chunk header, the PNG. */
async function icns(types: [string, number][]): Promise<Buffer> {
	const chunks = await Promise.all(
		types.map(async ([type, size]) => {
			const image = await png(size, MAC_GRID);
			const head = Buffer.alloc(8);
			head.write(type, 0, "ascii");
			head.writeUInt32BE(image.length + 8, 4);
			return Buffer.concat([head, image]);
		}),
	);
	const head = Buffer.alloc(8);
	head.write("icns", 0, "ascii");
	head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
	return Buffer.concat([head, ...chunks]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.png"), await png(512));
writeFileSync(join(OUT, "icon.ico"), await ico([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(
	join(OUT, "icon.icns"),
	await icns([
		["ic11", 32],
		["ic12", 64],
		["ic07", 128],
		["ic13", 256],
		["ic08", 256],
		["ic14", 512],
		["ic09", 512],
		["ic10", 1024],
	]),
);
console.log(`make-icons: icon.png, icon.ico and icon.icns in ${OUT}`);
