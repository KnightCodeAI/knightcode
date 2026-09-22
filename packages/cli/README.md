<p align="center">
  <a href="https://knightcode.dev">
    <img alt="KnightCode logo" src="https://knightcode.dev/knightcode-mark.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@knightcodeai/cli"><img alt="npm" src="https://img.shields.io/npm/v/@knightcodeai/cli?style=flat-square&logo=npm&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are closed automatically. Maintainers review closed submissions daily. See [CONTRIBUTING.md](https://github.com/KnightCodeAI/knightcode/blob/main/CONTRIBUTING.md).

# KnightCode

KnightCode is a minimal, extensible AI agent for the terminal. Adapt KnightCode to your workflow, not the other way around.

Ask KnightCode to create the prompt templates, skills, extensions, and themes you need, or install a KnightCode package. Use KnightCode directly, automate it in print, JSON, or RPC mode, or build applications with the TypeScript SDK.

## Getting started

Install the command-line interface with npm:

```bash
npm install -g --ignore-scripts @knightcodeai/cli
```

This requires Node.js 22 or newer. KnightCode does not require dependency lifecycle scripts for a normal npm installation. You do not need Bun: it is bundled into the platform binary, which installs automatically as an optional dependency for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64).

On macOS or Linux, you can instead use the installer:

```bash
curl -fsSL https://knightcode.dev/install.sh | sh
```

Start KnightCode in the directory where you want it to work:

```bash
cd /path/to/project
knightcode
```

For a built-in AI provider, run `/login` inside KnightCode to connect a subscription or API key. Then give KnightCode a task.

See the [documentation](docs/index.md) for full setup and usage instructions.

## Development

Clone the repository, install its dependencies, and run KnightCode from source:

```bash
git clone https://github.com/KnightCodeAI/knightcode
cd knightcode
bun install
bun run start
```

`bun run start` runs the CLI from source with the repository's `.env` loaded.

Before submitting changes, run:

```bash
bun run check-types
cd packages/<package> && bun x vitest --run test/<changed>.test.ts
```

Read [CONTRIBUTING.md](https://github.com/KnightCodeAI/knightcode/blob/main/CONTRIBUTING.md) before opening an issue or pull request. It defines the contribution gate, issue quality bar, and required checks. Read [AGENTS.md](https://github.com/KnightCodeAI/knightcode/blob/main/AGENTS.md) for repository-specific implementation, testing, dependency, and release rules.

## License

MIT
