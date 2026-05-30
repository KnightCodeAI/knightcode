export function assertSafeCommand(command: string): void {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();
  const forbiddenPatterns = [
    /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/,
    /\bgit\s+push\b.*\s--force(?:\s|$)/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[^\s]*f\b/,
    /\bdrop\s+table\b/,
    /\btruncate\s+table\b/,
    /\bdrop\s+database\b/,
    /^format\b/,
    /\bdeltree\b/,
    /\bdel\s+\/[^\s]*s[^\s]*q\b/,
    /\bremove-item\b.*\s-recurse\b.*\s-force\b/,
    /\bchmod\s+777\b/,
    /\bsudo\s+rm\b/,
    /\bkill\s+-9\s+1\b/,
    /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/,
  ];

  if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error("Refusing to run a destructive command");
  }
}

export function assertInteractiveCommandBlocked(command: string): void {
  const normalizedCmd = command.trim();
  const baseCmd = normalizedCmd.split(/\s+/)[0]?.toLowerCase() ?? "";

  const interactiveEditors = [
    "vim",
    "vi",
    "nvim",
    "nano",
    "emacs",
    "pico",
    "joe",
    "micro",
  ];
  if (interactiveEditors.includes(baseCmd)) {
    throw new Error(
      `Interactive editor "${baseCmd}" is not supported. Use the Edit or Write tools instead to modify files.`,
    );
  }

  if (baseCmd === "git") {
    const gitArgs = normalizedCmd.toLowerCase();
    if (/\bgit\s+rebase\s+(-i|--interactive)\b/.test(gitArgs)) {
      throw new Error(
        "Interactive git rebase is not supported. Use non-interactive rebase instead: git rebase <branch>",
      );
    }
    if (/\bgit\s+add\s+(-i|--interactive|-p|--patch)\b/.test(gitArgs)) {
      throw new Error(
        "Interactive git add is not supported. Use git add <file> to stage specific files.",
      );
    }
    if (
      /\bgit\s+commit\b/.test(gitArgs) &&
      !/(\s-m\s|\s--message[=\s]|\s-F\s|\s--file[=\s]|\s-C\s|\s--reuse-message[=\s]|\s--allow-empty-message)/.test(
        gitArgs,
      )
    ) {
      throw new Error(
        'git commit without -m would open an interactive editor. Use: git commit -m "your message"',
      );
    }
  }

  const sleepMatch = /^sleep\s+(\d+)/.exec(normalizedCmd);
  if (sleepMatch) {
    const seconds = parseInt(sleepMatch[1]!, 10);
    if (seconds >= 2) {
      throw new Error(
        `sleep ${seconds} is not allowed. Run commands directly — there's no need to wait. For long-running processes, use run_in_background: true.`,
      );
    }
  }
}
