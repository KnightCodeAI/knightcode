import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ServerConnection, type ServerState } from "../../src/main/server.ts";

class FakeChild extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = vi.fn();
	/** Every line written to stdin, parsed. */
	readonly received: Array<{ id?: string; method?: string }> = [];
	constructor() {
		super();
		this.stdin.setEncoding("utf8");
		this.stdin.on("data", (chunk: string) => {
			for (const line of chunk.split("\n")) if (line) this.received.push(JSON.parse(line));
		});
	}
	answerInitialize(): void {
		const request = this.received.find((m) => m.method === "initialize")!;
		this.stdout.write(`${JSON.stringify({ id: request.id, result: { serverInfo: { name: "knightcode" } } })}\n`);
	}
}

const children: FakeChild[] = [];

vi.mock("node:child_process", () => ({
	spawn: () => {
		const child = new FakeChild();
		children.push(child);
		return child;
	},
}));
vi.mock("../../src/main/log-file.ts", () => ({
	RotatingLog: class {
		write() {}
		end() {}
	},
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: delays are exactly 500, 1000, 2000...
	children.length = 0;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function connect() {
	const states: ServerState[] = [];
	const onExit = vi.fn();
	const server = new ServerConnection({
		command: { command: "knightcode", args: ["app-server"] },
		env: {},
		logsDir: "logs",
		clientVersion: "0.0.0",
		onMessage: () => {},
		onState: (state) => states.push(state),
		onExit,
	});
	server.start();
	return { server, states, onExit };
}

/** Let stream events and promise continuations run without moving the fake clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

test("an exit restarts the child after a delay that doubles with each exit", async () => {
	const { states, onExit } = connect();
	children[0]!.answerInitialize();
	await flush();
	expect(states).toEqual(["starting", "ready"]);

	children[0]!.emit("exit", 1, null);
	expect(onExit).toHaveBeenCalledOnce();
	expect(states.at(-1)).toBe("restarting");
	await vi.advanceTimersByTimeAsync(499);
	expect(children).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(children).toHaveLength(2);

	children[1]!.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(999);
	expect(children).toHaveLength(2);
	await vi.advanceTimersByTimeAsync(1);
	expect(children).toHaveLength(3);
});

test("five exits within two minutes stop the restart loop", async () => {
	const { states } = connect();
	for (let exit = 1; exit <= 5; exit++) {
		children.at(-1)!.emit("exit", 1, null);
		await vi.advanceTimersByTimeAsync(20_000);
	}
	expect(states.at(-1)).toBe("failed");
	expect(children).toHaveLength(5);
	await vi.advanceTimersByTimeAsync(120_000);
	expect(children).toHaveLength(5);
});

test("a child that never answers initialize is killed so its exit restarts it", async () => {
	connect();
	await vi.advanceTimersByTimeAsync(29_999);
	expect(children[0]!.kill).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(children[0]!.kill).toHaveBeenCalledOnce();
});

test("stop closes stdin and kills only after the deadline", async () => {
	const { server, onExit } = connect();
	const child = children[0]!;
	const stdinEnded = vi.fn();
	child.stdin.on("finish", stdinEnded);
	let stopped = false;
	void server.stop().then(() => (stopped = true));
	await flush();
	expect(stdinEnded).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(11_999);
	expect(child.kill).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(child.kill).toHaveBeenCalledOnce();
	child.emit("exit", null, "SIGTERM");
	await flush();
	expect(stopped).toBe(true);
	// A requested stop is not a crash: no restart.
	expect(onExit).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(20_000);
	expect(children).toHaveLength(1);
});

test("stop does not kill a child that exits on EOF", async () => {
	const { server } = connect();
	const child = children[0]!;
	const stopping = server.stop();
	await flush();
	child.emit("exit", 0, null);
	await stopping;
	await vi.advanceTimersByTimeAsync(20_000);
	expect(child.kill).not.toHaveBeenCalled();
});
