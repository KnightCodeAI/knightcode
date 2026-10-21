import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

// Packaging, signing and the bundled knightcode binary are phase S4 (desktop-shell.md section 15).
const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
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
