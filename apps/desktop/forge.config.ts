import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

/**
 * node-pty runs in main outside the bundle (main.ts requires it at runtime), and the Vite build leaves node_modules
 * out of the package. Copied from where it is installed: its package.json, its JS, and the target's binaries (the
 * prebuild, or a node-gyp build where there is none), without sources, tests or debug symbols. No binary fails the
 * package: every terminal would fail at run time instead.
 */
function copyNodePty(buildPath: string, platform: string, arch: string): void {
	const from = dirname(createRequire(__filename).resolve("node-pty/package.json"));
	const to = join(buildPath, "node_modules/node-pty");
	const runtime = (path: string) =>
		!/\.(pdb|lib|exp|ilk|obj|iobj|ipdb|map)$|\.test\.js$|(^|[\\/])obj([\\/]|$)/i.test(relative(from, path));
	cpSync(join(from, "package.json"), join(to, "package.json"));
	cpSync(join(from, "lib"), join(to, "lib"), { recursive: true, filter: runtime });
	const prebuilt = join(from, "prebuilds", `${platform}-${arch}`);
	const built = join(from, "build", "Release");
	if (existsSync(prebuilt)) cpSync(prebuilt, join(to, "prebuilds", `${platform}-${arch}`), { recursive: true, filter: runtime });
	else if (platform === process.platform && arch === process.arch && existsSync(built))
		cpSync(built, join(to, "build", "Release"), { recursive: true, filter: runtime });
	else throw new Error(`node-pty has no binary for ${platform}-${arch}: no prebuild, and no node-gyp build in ${built}`);
}

// Signing and the bundled knightcode binary are phase S4 (desktop-shell.md section 15).
const config: ForgeConfig = {
	hooks: {
		packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) =>
			copyNodePty(buildPath, platform, arch),
	},
	packagerConfig: {
		// node-pty's binaries, spawn-helper and its conout worker run from real files.
		asar: { unpack: "**/node_modules/node-pty/**" },
		name: "KnightCode",
		executableName: "knightcode-desktop",
		// macOS learns the link scheme from Info.plist; Windows and Linux register it at launch (src/main.ts).
		protocols: [{ name: "KnightCode", schemes: ["knightcode"] }],
	},
	makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"]), new MakerDMG({}), new MakerDeb({}), new MakerRpm({})],
	plugins: [
		new VitePlugin({
			build: [
				{ entry: "src/main.ts", config: "vite.main.config.ts", target: "main" },
				{ entry: "src/preload.ts", config: "vite.preload.config.ts", target: "preload" },
			],
			renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
		}),
		// desktop-shell.md section 6.3.
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
};

export default config;
