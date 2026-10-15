import { expect, test } from "vitest";
import { commandPrefix, matchesPrefix } from "../../src/app-server/command-prefix.ts";

type Shell = "bash" | "powershell";
const SHELLS: Shell[] = ["bash", "powershell"];

test("prefixes for recognised forms", () => {
	const offered: Array<[string, Shell, string]> = [
		["npm test src", "bash", "npm test"],
		["npm run build", "bash", "npm run build"],
		["git status", "bash", "git status"],
		["go run main.go", "bash", "go run main.go"],
		["python -m pytest tests", "bash", "python -m pytest"],
		["python scripts/check.py fix", "bash", "python scripts/check.py"],
		["npx cowsay hi", "bash", "npx cowsay"],
		["uv run pytest tests", "bash", "uv run pytest"],
		["bun x prettier src", "bash", "bun x prettier"],
		["docker ps", "bash", "docker ps"],
		["ls src", "bash", "ls"],
		["echo one", "bash", "echo"],
		// A program on no list gets two words, never its name alone (review round 4).
		["./build.sh release", "bash", "./build.sh release"],
		["pip install requests", "bash", "pip install"],
		["poetry install", "bash", "poetry install"],
		["poetry run pytest tests", "bash", "poetry run pytest"],
		["mytool sync all", "bash", "mytool sync"],
		["mytool run lint", "bash", "mytool run lint"],
		["Get-ChildItem src", "powershell", "Get-ChildItem"],
		["C:\\Tools\\python.exe check.py", "powershell", "C:\\Tools\\python.exe check.py"],
		["Npm Test", "powershell", "Npm Test"],
	];
	for (const [command, shell, prefix] of offered) expect(commandPrefix(command, shell), command).toBe(prefix);
});

test("no prefix, in either shell, for forms that chain, quote, dispatch or run other code", () => {
	const refused = [
		// Nested dispatchers (review round 3): the target is itself npm, git, python…
		"uv run npm test",
		"npx npm test",
		"uv run git status",
		"uv run npm exec node --eval=1",
		"npx npm exec node --eval=1",
		"bun x npm test",
		"npm exec node",
		"pnpm dlx tsx x.ts",
		"uv run python -c 1",
		"npm exec -- node -e 1",
		"python -m npm",
		"poetry run python -c 1",
		"pipx run npm",
		// Subcommands that run an arbitrary command inside something else.
		"docker run ubuntu",
		"docker compose up",
		"python /tmp/check.py",
		"mytool /flag",
		"mytool /tmp/script",
		"docker exec c ls",
		"kubectl exec pod ls",
		"podman run alpine",
		// A flag where the subcommand or script belongs.
		"bun -e 1",
		"git -C . status",
		"cargo run --release",
		"npx -y cowsay",
		"python -c 1",
		"node -e 1",
		"bash -c ls",
		"sh -c ls",
		"cmd /c dir",
		"pwsh -Command Get-Date",
		"python.exe -c 1",
		// Wrappers, sourcing, environment overrides, incomplete forms.
		"source check.sh",
		". check.sh",
		"sudo ls",
		"env FOO=1 ls",
		"PATH=/tmp npm test",
		"xargs rm",
		"timeout 5 ls",
		"nohup ls",
		"wsl ls",
		"wsl rm -rf /",
		"wsl.exe ls",
		"setsid ls",
		"busybox sh",
		"npx",
		"npm run",
		"invoke-expression x",
		"IEX x",
		"Start-Process notepad",
		// Programs on no list (review round 4): no subcommand, a flag first, or a dispatcher or bare runner second.
		"pip -V",
		"./build.sh",
		"mytool",
		"mytool --flag",
		"mytool run",
		"mytool run npm",
		"mytool npm test",
		// A flag, path flag or assignment after the prefix: options can run programs or write files.
		"rg --pre /tmp/x pattern",
		"rg --pre=x pattern",
		"tree -o out",
		"ls -la",
		"Get-ChildItem -Force",
		"make build CC=x",
		"npm test --script-shell=x",
		"npm test -- --ci",
		"go test -exec x",
		"git log --output=x",
		"python check.py -v",
		"dotnet build /p:x",
		// Operators, quotes, script blocks.
		"npm test && rm -rf build",
		"npm test; ls",
		"a | b",
		'npm test "x"',
		"Invoke-Command {ls}",
	];
	for (const shell of SHELLS)
		for (const command of refused) expect(commandPrefix(command, shell), `${shell}: ${command}`).toBeUndefined();
	// Shell-specific characters.
	for (const command of [
		"echo `id`",
		"echo $(id)",
		"echo ${HOME}",
		"cat a > b",
		"rm *.log",
		"ls ~",
		"echo a\\ b",
		"find . -exec rm {} +",
	])
		expect(commandPrefix(command, "bash"), command).toBeUndefined();
	for (const command of ["Write-Output @args", "a `\nb", "Remove-Item 'x'", "$(Get-Date)"])
		expect(commandPrefix(command, "powershell"), command).toBeUndefined();
});

test("a prefix covers only commands that would be offered exactly that prefix themselves", () => {
	const cases: Array<[string, string, Shell, boolean]> = [
		["npm test src", "npm test", "bash", true],
		["npm test -- --ci", "npm test", "bash", false],
		["npm testx", "npm test", "bash", false],
		["npm test; ls", "npm test", "bash", false],
		["npm run", "npm run build", "bash", false],
		["bun -e 1", "bun check.ts", "bash", false],
		["PATH=/tmp npm test", "npm test", "bash", false],
		["NPM test", "npm test", "bash", false],
		["NPM test", "npm test", "powershell", true],
		["python check.py fast", "python check.py", "bash", true],
		["python check.py -v", "python check.py", "bash", false],
		["python -c 1", "python check.py", "bash", false],
		["echo two words", "echo", "bash", true],
		["pip install requests", "pip install", "bash", true],
		["pip install -r requirements.txt", "pip install", "bash", false],
		["pip uninstall -y numpy", "pip install", "bash", false],
		["poetry run python -c 1", "poetry install", "bash", false],
	];
	for (const [command, prefix, shell, want] of cases)
		expect(matchesPrefix(command, prefix, shell), `${shell}: ${command}`).toBe(want);
	// Escalations the reviews reproduced, in both shells: even a stored prefix cannot cover them.
	for (const shell of SHELLS) {
		expect(matchesPrefix("uv run npm exec node --eval=1", "uv run npm", shell)).toBe(false);
		expect(matchesPrefix("npx npm exec node --eval=1", "npx npm", shell)).toBe(false);
		expect(matchesPrefix("uv run git push", "uv run git", shell)).toBe(false);
		// Review round 4: a one-word prefix for a program on no list covered every subcommand. A stored prefix
		// shorter than the command's own never matches, whatever produced it.
		expect(matchesPrefix("wsl rm -rf /", "wsl", shell)).toBe(false);
		expect(matchesPrefix("pip uninstall -y numpy", "pip", shell)).toBe(false);
		expect(matchesPrefix("poetry run python -c 1", "poetry", shell)).toBe(false);
		// Review round 5: options after an approved prefix ran programs or wrote files.
		expect(matchesPrefix("rg --pre /tmp/x pattern", "rg", shell)).toBe(false);
		expect(matchesPrefix("tree -o out", "tree", shell)).toBe(false);
		expect(matchesPrefix("git grep -O./x.sh foo", "git grep", shell)).toBe(false);
		expect(matchesPrefix("git grep --open-files-in-pager=./x.sh foo", "git grep", shell)).toBe(false);
		expect(matchesPrefix("git fetch --upload-pack=./x.sh", "git fetch", shell)).toBe(false);
		expect(matchesPrefix("npm test --script-shell=x", "npm test", shell)).toBe(false);
		expect(matchesPrefix("make build CC=x", "make build", shell)).toBe(false);
		expect(matchesPrefix("rg pattern src", "rg", shell)).toBe(true);
	}
});
