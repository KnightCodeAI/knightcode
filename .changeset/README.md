# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release:

```bash
bunx changeset
```

Pick a bump type (patch/minor/major) and write one sentence. Commit the generated
`.changeset/*.md` file with your PR. On merge to `main`, the Changesets bot opens a
"Version Packages" PR; merging that PR publishes all `@knightcodeai/cli*` packages.
