/**
 * Command prefixes for "allow commands that start with …" (§5.4). Fails closed: a prefix is offered only for
 * a command form recognised below, and a later command is covered only if it would get the same prefix itself.
 * Anything unrecognised (an operator, an expansion, a quote, a flag where a subcommand belongs, a wrapper, an
 * interpreter running inline code, or a nested target that is itself a dispatcher) is approved whole or not at all.
 * So is any command with a flag or assignment after its prefix: options can run programs (`rg --pre x`,
 * `go test -exec x`, `make CC=x`) or write files (`tree -o x`, `git log --output=x`).
 */

type Shell = "bash" | "powershell";

/** Characters that can chain, expand, quote, glob or redirect. Any of them anywhere: no prefix. */
const UNSAFE: Record<Shell, RegExp> = {
	bash: /[;&|`<>(){}[\]$\\'"*?!#~\n\r]/,
	powershell: /[;&|`<>(){}[\]$'"@\n\r]/,
};

/** Run another command given as arguments, or change how the shell runs one. Never a prefix. */
const WRAPPERS = new Set([
	"sudo",
	"doas",
	"su",
	"runas",
	"pkexec",
	"env",
	"xargs",
	"parallel",
	"find",
	"fd",
	"timeout",
	"nohup",
	"nice",
	"ionice",
	"time",
	"watch",
	"strace",
	"ltrace",
	"gdb",
	"exec",
	"eval",
	"command",
	"builtin",
	"source",
	".",
	"trap",
	"ssh",
	"wsl",
	"chroot",
	"setsid",
	"stdbuf",
	"unbuffer",
	"flock",
	"nsenter",
	"unshare",
	"systemd-run",
	"busybox",
	"start",
	"call",
	"invoke-expression",
	"iex",
	"invoke-command",
	"icm",
	"start-process",
	"saps",
	"start-job",
	"invoke-item",
	"ii",
]);
/** Run code they are given. A prefix only together with a script file or module, never with a flag. */
const INTERPRETERS = new Set([
	"python",
	"python3",
	"py",
	"pythonw",
	"node",
	"deno",
	"ruby",
	"perl",
	"php",
	"lua",
	"bash",
	"sh",
	"zsh",
	"fish",
	"dash",
	"ksh",
	"pwsh",
	"powershell",
	"cmd",
	"npx",
	"bunx",
	"pnpx",
	"uvx",
	"tsx",
	"ts-node",
	"awk",
	"gawk",
	"sed",
	"osascript",
	"wscript",
	"cscript",
	"mshta",
	"rundll32",
	"regsvr32",
	"java",
]);
/** Tools whose second word is the real command (`npm test`, `git push`). */
const MULTI = new Set([
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"git",
	"cargo",
	"go",
	"dotnet",
	"uv",
	"make",
	"docker",
	"podman",
	"kubectl",
	"gh",
	"pip",
	"pip3",
	"pipx",
	"poetry",
	"pdm",
	"hatch",
	"conda",
]);
/** Per tool, subcommands that run a named script or package binary: its name is part of the prefix (`npm run build`). */
const RUNNERS: Readonly<Record<string, ReadonlySet<string>>> = {
	npm: new Set(["run", "run-script", "exec", "x"]),
	pnpm: new Set(["run", "exec", "dlx"]),
	yarn: new Set(["run", "exec", "dlx"]),
	bun: new Set(["run", "x"]),
	uv: new Set(["run"]),
	go: new Set(["run"]),
	cargo: new Set(["run"]),
	pipx: new Set(["run"]),
	poetry: new Set(["run"]),
	pdm: new Set(["run"]),
	hatch: new Set(["run"]),
	conda: new Set(["run"]),
};
/** Per tool, subcommands that run an arbitrary command inside something else: never a prefix. */
const DISPATCHERS: Readonly<Record<string, ReadonlySet<string>>> = {
	docker: new Set(["run", "exec", "compose"]),
	podman: new Set(["run", "exec", "compose"]),
	kubectl: new Set(["exec", "run", "debug", "attach"]),
	dotnet: new Set(["exec"]),
	git: new Set(["submodule"]),
	gh: new Set(["extension", "alias"]),
};
/** Programs with no subcommands: the name alone is the prefix. A name missing here only narrows its prefix. */
const SIMPLE = new Set([
	"ls",
	"dir",
	"cat",
	"type",
	"echo",
	"pwd",
	"head",
	"tail",
	"wc",
	"grep",
	"rg",
	"diff",
	"stat",
	"file",
	"tree",
	"du",
	"df",
	"which",
	"whoami",
	"date",
	"uname",
	"get-childitem",
	"gci",
	"get-content",
	"gc",
	"get-item",
	"get-location",
	"select-string",
	"test-path",
	"get-date",
]);
/** Subcommands that, in a tool on no list, run a named target: the target is part of the prefix. */
const RUNNER_WORDS = new Set(["run", "exec", "x", "dlx"]);
const PYTHON = new Set(["python", "python3", "py"]);

const words = (command: string): string[] => command.trim().split(/\s+/).filter(Boolean);

/** How a word names a program: last path segment, lower case, without an executable suffix. */
const programName = (word: string): string =>
	(word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, "");

/** A program that can run other programs: a nested target like this makes a prefix cover too much. */
const dispatches = (word: string): boolean => {
	const name = programName(word);
	return WRAPPERS.has(name) || INTERPRETERS.has(name) || MULTI.has(name);
};

/** An argument that names something rather than configuring the program: not a flag, not an assignment. */
const isName = (word: string | undefined): word is string =>
	word !== undefined && !word.startsWith("-") && !word.startsWith("/") && !word.includes("=");

/** `first second third` when `third` names a target that is not itself a dispatcher; otherwise no prefix. */
const withTarget = (first: string, second: string, third: string | undefined): string | undefined =>
	isName(third) && !dispatches(third) ? `${first} ${second} ${third}` : undefined;

export function commandPrefix(command: string, shell: Shell): string | undefined {
	const prefix = formPrefix(command, shell);
	if (prefix === undefined) return undefined;
	return words(command).slice(words(prefix).length).every(isName) ? prefix : undefined;
}

function formPrefix(command: string, shell: Shell): string | undefined {
	if (UNSAFE[shell].test(command)) return undefined;
	const [first, second, third] = words(command);
	if (first === undefined || first.includes("=")) return undefined; // FOO=1 cmd overrides the environment
	const name = programName(first);
	if (WRAPPERS.has(name)) return undefined;
	if (INTERPRETERS.has(name)) {
		if (PYTHON.has(name) && second === "-m") return withTarget(first, second, third);
		return isName(second) && !dispatches(second) ? `${first} ${second}` : undefined;
	}
	if (SIMPLE.has(name)) return first;
	// A multi-command tool, or a program on no list, which may be one: a flag before the subcommand (`git -C .`,
	// `bun -e`, `pip -V`) or no subcommand at all is a form this code does not understand.
	if (!isName(second) || dispatches(second)) return undefined;
	const sub = second.toLowerCase();
	if (MULTI.has(name)) {
		if (DISPATCHERS[name]?.has(sub)) return undefined;
		if (RUNNERS[name]?.has(sub)) return withTarget(first, second, third);
		return `${first} ${second}`;
	}
	// A program on no list gets its first two words, never its name alone: approving `pip install` must not
	// cover `pip uninstall`. A generic runner subcommand needs its target as well (`mytool run lint`).
	if (RUNNER_WORDS.has(sub)) return withTarget(first, second, third);
	return `${first} ${second}`;
}

/**
 * Covered only when the command would be offered exactly this prefix itself (case-insensitively in PowerShell).
 * Every rule that refuses to offer a prefix also refuses to match one, and a stored prefix shorter than the
 * command's own (`pip` against `pip uninstall`) never widens what an approval covers.
 */
export function matchesPrefix(command: string, prefix: string, shell: Shell): boolean {
	const own = commandPrefix(command, shell);
	if (own === undefined) return false;
	const have = words(own);
	const want = words(prefix);
	const same = (a: string, b: string) => (shell === "powershell" ? a.toLowerCase() === b.toLowerCase() : a === b);
	return have.length === want.length && have.every((word, i) => same(word, want[i]));
}
