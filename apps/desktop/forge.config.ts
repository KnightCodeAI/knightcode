import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { cpSync, existsSync, readFileSync } from "node:fs";
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

/**
 * electron-winstaller copies the host's 7-Zip to vendor/7z.exe in an install script, which Bun does not run for a
 * package it does not trust, and Squirrel cannot zip the app without it. The same copy, here.
 */
function select7zip(): void {
	const vendor = join(dirname(createRequire(__filename).resolve("electron-winstaller/package.json")), "vendor");
	for (const ext of ["exe", "dll"]) {
		const to = join(vendor, `7z.${ext}`);
		if (!existsSync(to)) cpSync(join(vendor, `7z-${process.arch}.${ext}`), to);
	}
}

const SERVER = join(__dirname, "resources/knightcode");

/** The app server scripts/stage-server.ts staged must be this checkout's CLI, built for the target being packaged. */
function checkStagedServer(platform: string, arch: string): void {
	const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);
	const staged = read(join(SERVER, "knightcode.version"));
	const { version } = JSON.parse(readFileSync(join(__dirname, "../../packages/cli/package.json"), "utf8")) as {
		version: string;
	};
	const target = read(join(SERVER, "knightcode.target"));
	const stage = `bun run scripts/stage-server.ts --platform=${platform} --arch=${arch}`;
	if (!staged) throw new Error(`No app server staged in ${SERVER}. Run: ${stage}`);
	if (staged !== version) throw new Error(`The staged app server is ${staged}, the CLI is ${version}. Run: ${stage}`);
	if (target !== `${platform}-${arch}`) throw new Error(`The staged app server is for ${target}. Run: ${stage}`);
}

const env = (name: string) => process.env[name]?.trim() || undefined;

// Ad hoc until a Developer ID exists. identityValidation: false stops osx-sign looking "-" up as a keychain identity,
// and continueOnError: false makes a signing failure fail the build instead of a warning. No hardened runtime ad hoc:
// its library validation refuses the separately signed Electron Framework on macOS 26 and later ("different Team
// IDs", the app never starts), and only notarization, which needs the Developer ID, requires it.
const appleIdentity = env("APPLE_SIGNING_IDENTITY");
const osxSign = appleIdentity
	? { identity: appleIdentity, continueOnError: false }
	: { identity: "-", identityValidation: false, continueOnError: false, optionsForFile: () => ({ hardenedRuntime: false }) };
const appleId = env("APPLE_ID");
const applePassword = env("APPLE_APP_SPECIFIC_PASSWORD");
const appleTeam = env("APPLE_TEAM_ID");
const osxNotarize =
	appleId && applePassword && appleTeam ? { appleId, appleIdPassword: applePassword, teamId: appleTeam } : undefined;
const certificateFile = env("WINDOWS_SIGN_CERTIFICATE_FILE");
const windowsSign = certificateFile
	? { certificateFile, certificatePassword: env("WINDOWS_SIGN_CERTIFICATE_PASSWORD") }
	: undefined;

const linux = {
	name: "knightcode-desktop",
	productName: "KnightCode",
	bin: "knightcode-desktop",
	icon: join(__dirname, "assets/icon.png"),
	categories: ["Development" as const],
	homepage: "https://knightcode.dev",
	mimeType: ["x-scheme-handler/knightcode"],
};

const config: ForgeConfig = {
	hooks: {
		prePackage: async (_config, platform, arch) => checkStagedServer(platform, arch),
		preMake: async () => {
			if (process.platform === "win32") select7zip();
		},
		packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) =>
			copyNodePty(buildPath, platform, arch),
	},
	packagerConfig: {
		// node-pty's binaries, spawn-helper and its conout worker run from real files.
		asar: { unpack: "**/node_modules/node-pty/**" },
		name: "KnightCode",
		executableName: "knightcode-desktop",
		appBundleId: "dev.knightcode.desktop",
		// .ico on Windows, .icns on macOS; Linux takes the .png through its makers.
		icon: join(__dirname, "assets/icon"),
		// The app server main runs (server.ts resolveServerCommand), at resources/knightcode.
		extraResource: [SERVER],
		// macOS learns the link scheme from Info.plist; Windows and Linux register it at launch (src/main.ts).
		protocols: [{ name: "KnightCode", schemes: ["knightcode"] }],
		osxSign,
		...(osxNotarize ? { osxNotarize } : {}),
		...(windowsSign ? { windowsSign } : {}),
	},
	makers: [
		new MakerSquirrel({
			// The install directory (%LOCALAPPDATA%\KnightCodeDesktop) and the update package's id. Not "KnightCode":
			// that directory holds the discontinued IDE's data, and Squirrel's uninstall deletes the whole directory.
			name: "KnightCodeDesktop",
			title: "KnightCode",
			setupIcon: join(__dirname, "assets/icon.ico"),
			// Programs and Features shows this URL's icon, Squirrel's default otherwise.
			iconUrl: "https://knightcode.dev/favicon.ico",
			...(windowsSign ? { windowsSign } : {}),
		}),
		new MakerZIP({}, ["darwin"]),
		new MakerDMG({ icon: join(__dirname, "assets/icon.icns"), format: "ULFO" }),
		new MakerDeb({ options: { ...linux, maintainer: "KnightCode" } }),
		new MakerRpm({ options: { ...linux, license: "MIT" } }),
	],
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
