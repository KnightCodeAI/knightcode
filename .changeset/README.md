# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release:

```bash
bun run changeset [category] [bump] [cli|desktop]   # defaults: fixed patch cli
```

Finish the sentence it leaves you. The category verb it starts with — `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed` or `Security` — is what groups the
entry under the matching heading in the changelog, so keep it as the first word.
`bun run scripts/changelog-sections.ts` checks that before CI does.

`cli` releases `@knightcodeai/cli` (the terminal and the app server); `desktop`
releases `@knightcode/desktop`, the desktop app. A change to both takes one of
each.

Commit the generated `.changeset/*.md` file with your PR. On merge to `main`,
the Changesets bot opens a "Version Packages" PR; merging that PR publishes all
`@knightcodeai/cli*` packages and sets the desktop app's next version and
changelog, which `.github/workflows/desktop-release.yml` builds and drafts when
it is run.
