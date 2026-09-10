import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { KeychainCredentialStore } from "../../src/engine/keychain-store.ts";
import { createFileAccountIndex, createMemorySecretBackend } from "../../src/engine/secrets.ts";

describe("KeychainCredentialStore", () => {
	const tempDir = join(tmpdir(), `knightcode-test-keychain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const indexPath = join(tempDir, "engine-accounts.json");

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	function createStore() {
		const backend = createMemorySecretBackend();
		const store = new KeychainCredentialStore({ backend, index: createFileAccountIndex(indexPath) });
		return { backend, store };
	}

	test("read returns undefined for an unknown provider", async () => {
		const { store } = createStore();
		expect(await store.read("anthropic")).toBeUndefined();
	});

	test("modify persists a credential that read returns", async () => {
		const { store } = createStore();
		const written = await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		expect(written).toEqual({ type: "api_key", key: "sk-test" });
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-test" });
	});

	test("modify sees the current credential", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "first" }));
		const seen: (string | undefined)[] = [];
		await store.modify("anthropic", async (current) => {
			seen.push(current?.type === "api_key" ? current.key : undefined);
			return { type: "api_key", key: "second" };
		});
		expect(seen).toEqual(["first"]);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "second" });
	});

	test("modify returning undefined leaves the entry unchanged", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "keep" }));
		const result = await store.modify("anthropic", async () => undefined);
		expect(result).toEqual({ type: "api_key", key: "keep" });
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "keep" });
	});

	test("concurrent modify calls on one provider serialize", async () => {
		const { store } = createStore();
		const order: string[] = [];
		const slow = store.modify("anthropic", async () => {
			order.push("a:start");
			await new Promise((resolve) => setTimeout(resolve, 30));
			order.push("a:end");
			return { type: "api_key", key: "a" };
		});
		const fast = store.modify("anthropic", async (current) => {
			order.push(`b:start:${current?.type === "api_key" ? current.key : "none"}`);
			return { type: "api_key", key: "b" };
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual(["a:start", "a:end", "b:start:a"]);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "b" });
	});

	test("a rejecting modify propagates and does not block the next write", async () => {
		const { store } = createStore();
		await expect(
			store.modify("anthropic", async () => {
				throw new Error("login failed");
			}),
		).rejects.toThrow("login failed");
		await store.modify("anthropic", async () => ({ type: "api_key", key: "after" }));
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "after" });
	});

	test("modify on different providers does not serialize across them", async () => {
		const { store } = createStore();
		const order: string[] = [];
		const a = store.modify("anthropic", async () => {
			order.push("a:start");
			await new Promise((resolve) => setTimeout(resolve, 30));
			order.push("a:end");
			return { type: "api_key", key: "a" };
		});
		const b = store.modify("openai", async () => {
			order.push("b:start");
			return { type: "api_key", key: "b" };
		});
		await Promise.all([a, b]);
		expect(order).toEqual(["a:start", "b:start", "a:end"]);
	});

	test("list reports metadata without secrets", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await store.modify("openai", async () => ({
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() + 60_000,
		}));
		const listed = await store.list();
		expect([...listed].sort((a, b) => a.providerId.localeCompare(b.providerId))).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: "openai", type: "oauth" },
		]);
		expect(JSON.stringify(listed)).not.toContain("sk-test");
	});

	test("list does not duplicate a provider written twice", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "one" }));
		await store.modify("anthropic", async () => ({ type: "api_key", key: "two" }));
		expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
	});

	test("delete removes the secret and the index entry", async () => {
		const { backend, store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await store.delete("anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
		expect(await backend.get("provider:anthropic")).toBeNull();
	});

	test("an indexed provider with no stored secret is dropped from list", async () => {
		const { backend, store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await backend.delete("provider:anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});

	test("concurrent writes for different providers do not lose index entries", async () => {
		// The credential write is serialized per provider, but the account index
		// is shared. A slow index makes the read-modify-write overlap the way it
		// does on a real filesystem.
		const backend = createMemorySecretBackend();
		let entries: readonly { providerId: string; type: "api_key" | "oauth" }[] = [];
		const slowIndex = {
			async read() {
				await new Promise((resolve) => setTimeout(resolve, 20));
				return entries;
			},
			async write(next: readonly { providerId: string; type: "api_key" | "oauth" }[]) {
				await new Promise((resolve) => setTimeout(resolve, 20));
				entries = [...next];
			},
		};
		const store = new KeychainCredentialStore({ backend, index: slowIndex });

		await Promise.all([
			store.modify("anthropic", async () => ({ type: "api_key", key: "a" })),
			store.modify("openai", async () => ({ type: "api_key", key: "b" })),
			store.modify("xai", async () => ({ type: "api_key", key: "c" })),
		]);

		const listed = await store.list();
		expect([...listed].map((entry) => entry.providerId).sort()).toEqual(["anthropic", "openai", "xai"]);
	});

	test("a corrupt stored value reads as undefined rather than throwing", async () => {
		const { backend, store } = createStore();
		await backend.set("provider:anthropic", "not json");
		expect(await store.read("anthropic")).toBeUndefined();
	});
});
