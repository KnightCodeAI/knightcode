// The UI's data: a keyed cache of API reads, live updates from socket events, and hooks over both.
import type {
	ApiClient,
	Bot,
	ConversationView,
	Group,
	Section,
	ServerEvent,
	WebSocketLike,
} from "@knightcode/bots-protocol";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { type ThreadSocket, type ThreadTarget, threadKey } from "./socket.ts";

type Entry = { data?: unknown; error?: Error; pending?: Promise<void>; loader?: () => Promise<unknown> };

/** What every screen reads and writes through. */
export class BotsStore {
	readonly api: ApiClient;
	readonly socket: ThreadSocket;
	private readonly entries = new Map<string, Entry>();
	private readonly listeners = new Set<() => void>();
	private version = 0;

	constructor(api: ApiClient, socket: ThreadSocket) {
		this.api = api;
		this.socket = socket;
		socket.onEvent((event) => this.applyEvent(event));
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Changes whenever any cached value changes; for useSyncExternalStore. */
	snapshot = (): number => this.version;

	/** The cached value for `key`, loading it with `loader` the first time. */
	read<T>(key: string, loader: () => Promise<T>): Entry {
		let entry = this.entries.get(key);
		if (!entry) {
			entry = { loader };
			this.entries.set(key, entry);
			this.load(key, entry);
		}
		return entry;
	}

	/** Loads `key` again; screens call it after a write. */
	reload(key: string): void {
		const entry = this.entries.get(key);
		if (entry?.loader) this.load(key, entry);
	}

	/** Replaces a cached value, as a write's response or a live event does. */
	set<T>(key: string, update: (current: T | undefined) => T | undefined): void {
		const entry = this.entries.get(key) ?? {};
		entry.data = update(entry.data as T | undefined);
		this.entries.set(key, entry);
		this.changed();
	}

	private load(key: string, entry: Entry): void {
		const loader = entry.loader;
		if (!loader) return;
		entry.pending = loader().then(
			(data) => {
				entry.data = data;
				entry.error = undefined;
				entry.pending = undefined;
				this.changed();
			},
			(error: unknown) => {
				entry.error = error instanceof Error ? error : new Error(String(error));
				entry.pending = undefined;
				this.changed();
			},
		);
	}

	private changed(): void {
		this.version++;
		for (const listener of this.listeners) listener();
	}

	private applyEvent(event: ServerEvent): void {
		if (event.kind === "bot")
			this.set<BotList>(BOTS, (list) => list && { ...list, bots: upsert(list.bots, event.bot) });
		else if (event.kind === "bot-removed")
			this.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.filter((b) => b.id !== event.botId) });
		else if (event.kind === "group")
			this.set<BotList>(BOTS, (list) => list && { ...list, groups: upsert(list.groups, event.group) });
		else if (event.kind === "computer") this.set(COMPUTER, () => event.state);
		else if (event.kind === "inbox") this.reload(INBOX);
		else if (event.kind === "approval") this.reload(INBOX);
	}
}

export interface BotList {
	bots: Bot[];
	groups: Group[];
	sections: Section[];
}

export const BOTS = "bots";
export const INBOX = "inbox";
export const COMPUTER = "computer";

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
	return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

export const StoreContext = createContext<BotsStore | null>(null);

/** The store of the nearest `BotsApp`. */
export function useStore(): BotsStore {
	const store = useContext(StoreContext);
	if (!store) throw new Error("useStore needs a BotsApp above it");
	return store;
}

export interface Resource<T> {
	data: T | undefined;
	error: Error | undefined;
	loading: boolean;
	reload: () => void;
}

/** A cached API read; `key` null skips it. */
export function useResource<T>(key: string | null, loader: (api: ApiClient) => Promise<T>): Resource<T> {
	const store = useStore();
	useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
	const entry = key ? store.read(key, () => loader(store.api)) : undefined;
	const reload = useCallback(() => key && store.reload(key), [store, key]);
	return {
		data: entry?.data as T | undefined,
		error: entry?.error,
		loading: Boolean(entry?.pending) && entry?.data === undefined,
		reload,
	};
}

/** Every bot, group and sidebar section, kept live. */
export function useBots(): Resource<BotList> {
	return useResource(BOTS, (api) => api.listBots({}));
}

/** One bot, from the live list. */
export function useBot(id: string | undefined): Bot | undefined {
	return useBots().data?.bots.find((bot) => bot.id === id);
}

/** A thread's live view: undefined until the first snapshot arrives. */
export function useConversation(target: ThreadTarget | undefined): ConversationView | undefined {
	const store = useStore();
	const key = target ? threadKey(target) : undefined;
	const [view, setView] = useState<ConversationView | undefined>(() =>
		target ? store.socket.view(target) : undefined,
	);
	useEffect(() => {
		if (!target) return;
		setView(store.socket.view(target));
		return store.socket.watch(target, setView);
		// `key` stands for the target: a new object naming the same thread must not resubscribe.
	}, [store, key]);
	return view;
}

/** Everything `BotsApp` needs from its host: the API and a socket factory. */
export interface BotsClient {
	api: ApiClient;
	connect: () => WebSocketLike;
}
