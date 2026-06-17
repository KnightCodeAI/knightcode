// scripts/sync-root-docs.ts — regenerate the repo-root README.md and CHANGELOG.md
// from the canonical CLI docs, so GitHub's home page shows the real project.
//
// GitHub always renders the repo-root README.md and won't follow a symlink, so we
// copy instead. Source of truth lives in packages/cli/ — never edit the root
// copies by hand. Run with `bun run scripts/sync-root-docs.ts` (or `bun run
// sync:docs`); it's also invoked automatically during `ci:version`.
//
// The CHANGELOG is a verbatim copy. The README is the lean, npm-facing CLI README
// plus a root-only suffix (monorepo layout + development) that's irrelevant to npm
// users but useful on the repo home page. Edit that suffix in README_SUFFIX below.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const BANNER =
  "<!-- AUTO-GENERATED — do not edit. Source: packages/cli/{file}" +
  "{extra}. Run `bun run sync:docs` to regenerate. -->\n\n";

// Appended to the root README only — not published to npm.
const README_SUFFIX = `
## Repository layout

This is a [Turborepo](https://turborepo.dev/) monorepo managed with
[bun](https://bun.sh/).

| Path | Description |
| ---- | ----------- |
| \`packages/cli\` | The \`@knightcodeai/cli\` package — the \`knightcode\` CLI source |
| \`packages/cli-*\` | Per-platform prebuilt binaries published as optional deps |
| \`packages/shared\` | Shared library code used across packages |
| \`packages/ui\` | Shared React component library |
| \`packages/eslint-config\`, \`packages/typescript-config\` | Shared tooling config |
| \`apps/web\` | Marketing / docs website |

## Development

Requires [bun](https://bun.sh/) (\`bun@1.3.3\`) and Node.js >=20.

\`\`\`bash
bun install        # install dependencies
bun run dev:cli    # run the CLI from source with watch mode
bun run build:cli  # build the standalone binary
bun run link:cli   # build and link \`knightcode\` globally
\`\`\`

Other useful scripts:

\`\`\`bash
bun run lint         # lint all packages
bun run check-types  # type-check all packages
bun run format       # format with Prettier
bun run sync:docs    # regenerate the root README.md and CHANGELOG.md
\`\`\`

## Releases

Releases are managed with [Changesets](https://github.com/changesets/changesets).
To record a change for the next release:

\`\`\`bash
bunx changeset
\`\`\`

Pick a bump type (patch/minor/major) and write one sentence. Commit the generated
\`.changeset/*.md\` file with your PR. On merge to \`main\`, the Changesets bot opens a
"Version Packages" PR; merging that PR publishes all \`@knightcodeai/cli*\` packages.

See [\`CHANGELOG.md\`](./CHANGELOG.md) for the release history.

## License

[Apache-2.0](./LICENSE). Copyright 2026 KnightCodeAI.
`;

const FILES = [
  { name: "README.md", suffix: README_SUFFIX },
  { name: "CHANGELOG.md", suffix: "" },
];

for (const { name, suffix } of FILES) {
  const src = join(ROOT, "packages", "cli", name);
  const dest = join(ROOT, name);
  const body = readFileSync(src, "utf8");
  const banner = BANNER.replace("{file}", name).replace(
    "{extra}",
    suffix ? " plus the README_SUFFIX in scripts/sync-root-docs.ts" : "",
  );
  const next = banner + body.trimEnd() + (suffix ? "\n" + suffix : "\n");
  const current = (() => {
    try {
      return readFileSync(dest, "utf8");
    } catch (err) {
      // Only treat a missing destination as "no current content"; surface real
      // errors (permissions, etc.) instead of silently overwriting.
      if ((err as { code?: string })?.code === "ENOENT") return null;
      throw err;
    }
  })();
  if (current === next) {
    console.log(`sync-root-docs: ${name} already up to date`);
    continue;
  }
  writeFileSync(dest, next);
  console.log(`sync-root-docs: wrote ${name} from packages/cli/${name}`);
}
