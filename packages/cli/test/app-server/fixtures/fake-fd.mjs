// Stand-in for fd: exit code, repeat count, ...lines, "--", fd flags (ignored).
const args = process.argv.slice(2);
const code = Number(args[0]);
const repeat = Number(args[1]);
const lines = args.slice(2, args.indexOf("--"));
let out = "";
for (let i = 0; i < repeat; i++) for (const line of lines) out += `${line}\n`;
process.stdout.write(out);
if (code !== 0) process.stderr.write("fd: some/dir: Permission denied (os error 13)\n");
process.exitCode = code;
// A real child held until the lister kills it, for shutdown precedence coverage.
if (code === 99) {
	process.exitCode = 0;
	setInterval(() => {}, 1000);
}
