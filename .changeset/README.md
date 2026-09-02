# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release:

```bash
bun run changeset [category] [bump]   # defaults: fixed patch
```

Finish the sentence it leaves you. The category verb it starts with — `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed` or `Security` — is what groups the
entry under the matching heading in the changelog, so keep it as the first word.
`bun run scripts/changelog-sections.ts` checks that before CI does.

Commit the generated `.changeset/*.md` file with your PR. On merge to `main`,
the Changesets bot opens a "Version Packages" PR; merging that PR publishes all
`@knightcodeai/cli*` packages.
