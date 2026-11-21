/** The standard and custom composer hooks are both owned by the selected provider epoch. */
import { defineDesktopExtension, type experimental_EditorAdapter } from "@knightcodeai/cli/desktop";
import type * as React from "react";
import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

const layout = vi.hoisted(() => ({ capturing: false, effects: [] as EffectCallback[] }));
vi.hoisted(() => Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } }));
vi.mock("react", async (original) => {
	const react = await original<typeof React>();
	return {
		...react,
		useSyncExternalStore: <T>(subscribe: (listener: () => void) => () => void, read: () => T) =>
			react.useSyncExternalStore(subscribe, read, read),
		useLayoutEffect: (effect: EffectCallback, deps?: readonly unknown[]) => {
			if (layout.capturing) layout.effects.push(effect);
			else react.useLayoutEffect(effect, deps);
		},
	};
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));
vi.mock("../../src/renderer/extensions/composer-behavior.tsx", () => ({
	useComposerBehavior: () => ({ target, controller, text: "" }),
}));

import { FrontendActivation } from "../../src/renderer/extensions/activation.ts";
import { composerController } from "../../src/renderer/extensions/composer-controller.ts";
import { ComposerRoot, useComposerEditor } from "../../src/renderer/extensions/composer-root.tsx";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { desktopExtensions } from "../../src/renderer/extensions/runtime.ts";
import { startupLayout } from "../../src/renderer/extensions/startup.ts";

let target: { threadId: string };
let controller: ReturnType<typeof composerController>;
afterEach(() => vi.unstubAllGlobals());

for (const editor of ["standard", "custom"] as const) {
	for (const retirement of ["reload", "disable"] as const) {
		test(`${retirement} releases a composing ${editor} adapter and leaves the draft for the next editor`, async () => {
			const disposeHost = initializeDesktopExtensions();
			vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {} });
			target = { threadId: `${retirement}-${editor}` };
			controller = composerController(target, new AbortController().signal);
			const activate = (revision: string) => {
				const activation = new FrontendActivation(
					{ owner: "editor", revision, epoch: revision, window: "w", mount: revision },
					globalThis.__knightcodeDesktop!,
					() => {},
				);
				activation.publish();
				activation.ready();
				return activation;
			};
			const activation = activate("one");
			let composing = false;
			const adapter: experimental_EditorAdapter = {
				experimental_read: () => ({ text: "", focused: false, composing }),
				experimental_apply() {},
				experimental_focus() {},
				experimental_caretAnchor: () => undefined,
			};
			const Probe = () => {
				layout.capturing = true;
				try {
					if (editor === "standard") useComposerEditor(adapter);
					else activation.sdk.experimental_useComposerEditor(adapter);
				} finally {
					layout.capturing = false;
				}
				return createElement("b", null, "extension editor");
			};
			const register = (owner: FrontendActivation, render: () => React.ReactNode) =>
				desktopExtensions
					.prepare(
						"editor",
						defineDesktopExtension((app) =>
							app.experimental_registerProvider({
								id: "selected",
								surface: "composer",
								experimental_render: render,
							}),
						),
						owner.binding.revision,
						owner,
					)
					.commit();
			const old = register(activation, Probe);
			const fallback = desktopExtensions
				.prepare(
					"builtin.composer",
					defineDesktopExtension((app) => {
						app.experimental_registerProvider({
							id: "default",
							surface: "composer",
							experimental_render: () => createElement("b", null, "fallback editor"),
						});
					}),
				)
				.commit();
			startupLayout.update({ composer: "editor/selected" }, []);
			let replacement: FrontendActivation | undefined;
			let next: ReturnType<typeof register> | undefined;
			try {
				const render = () => renderToStaticMarkup(createElement(ComposerRoot, target));
				expect(render()).toContain("extension editor");
				const [mount] = layout.effects.splice(0);
				mount!();
				composing = true;
				expect(controller.experimental_focus()).toMatchObject({ status: "busy" });
				let quiesced = false;
				const idle = activation.quiesce(new AbortController().signal).then(
					() => {
						quiesced = true;
					},
					() => {},
				);
				await Promise.resolve();
				expect(quiesced).toBe(false);
				activation.dispose();
				if (retirement === "reload") {
					replacement = activate("two");
					next = register(replacement, () => createElement("b", null, "replacement editor"));
				} else old.dispose();
				await idle;
				expect(controller.experimental_focus()).toMatchObject({ status: "unavailable" });
				expect(controller.experimental_getSnapshot()).toMatchObject({ composing: false });
				if (retirement === "reload") {
					expect(
						desktopExtensions.resolveProvider("composer", "builtin.composer/default", "editor/selected", {
							sidebarOpen: false,
						})?.revision,
					).toBe("two");
				} else expect(render()).toContain("fallback editor");
			} finally {
				layout.effects.length = 0;
				startupLayout.update({}, []);
				old.dispose();
				fallback.dispose();
				next?.dispose();
				replacement?.dispose();
				activation.dispose();
				disposeHost();
			}
		});
	}
}
