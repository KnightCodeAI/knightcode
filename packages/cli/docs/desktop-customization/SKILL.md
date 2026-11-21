---
name: desktop-customization
description: Use when the user asks to customize KnightCode Desktop UI or diagnose a native desktop extension.
---

# Desktop customization

Read `../desktop-extensions.md` first. Read `../desktop-api.md` and
`../desktop-sdk.d.ts` for the installed API, not APIs from a different release.
The preview supports commands, slots and providers, settings, composer and
workspace controls, and coordinated backends. Check the installed guide and
SDK before promising a specific surface or capability.

## Authoring loop

Use the installed `knightcode` executable beside the docs directory:
`../../knightcode.exe` on Windows, `../../knightcode` on POSIX, relative
to this skill's directory. Resolve it to an absolute path and quote it.
An npm installation uses `knightcode` on PATH. In a source checkout use
`bun packages/cli/src/bun/cli.ts` from the repository root.

1. Run `desktop-ext new <name> --json`. Edit its source, using only the public
   SDK and supported runtime imports. The result also locates shipped examples.
2. Run `desktop-ext validate <directory> --json`. Fix each error. Validation
   checks modules and CSS; it does not execute setup or prove rendering.
3. Ask the user to review and approve the source in Settings → Extensions &
   skills. **Trust development reloads** permits future edits at this source.
   Creation and validation do not grant consent. Do not edit consent files.
4. Run `desktop-ext reload --json`, then `desktop-ext status --json`.
   Read each server/window diagnostic and compare its revision. Reload only
   requests activation; it does not prove success. Fix errors, validate and
   repeat. Development-approved directories reload on save.
5. Confirm the intended UI change and check unrelated UI. A failed candidate
   retains the previous live revision; do not mistake old UI for a successful
   fix. Disable or restore the source to undo the change.

Use authored CSS and published tokens, not arbitrary host Tailwind classes.
Use the SDK portal for overlays. Keep services out of synchronous setup.
If the renderer becomes unusable, use View → Restart without extensions or
launch the app with `--safe-mode`. Do not interrupt running work silently.

## Common mistakes

- A valid package is not an approved or active package.
- An empty status from a different agent directory is not the live desktop.
- An unsupported composer/sidebar API cannot be replaced with private imports
  or DOM patching.
