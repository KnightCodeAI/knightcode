# Backend data contexts

Backend declarations live in `@knightcodeai/cli/desktop-backend`. Setup declares
schemas and services; it does not read/write data or start services. The host
validates existing values during preparation and rereads them after admitted
old writes drain. A schema mismatch rejects the candidate. Preparation never
migrates or rolls back saved data.

## Explicit identities

App/user data is the default for settings and storage handles. For project or
thread data, resolve an explicit selector with the operation's abort signal:

```ts
const context = await app.experimental_context(
  { scope: "thread", cwd: params.cwd, threadId: params.threadId },
  signal,
);
const previous = count.experimental_get(context) ?? 0;
count.experimental_set(previous + 1, context);
```

`cwd` must be absolute and identify an existing, trusted project. Managed
worktrees use their owning project's identity. Thread selectors must name a
saved thread in that project. Resolution uses session headers and workspace
placement without opening an agent session or taking ownership of its lock.
No selected-window or selected-thread pointer is consulted.

The returned context belongs to one backend activation. It cannot be sent over
RPC, forged, or reused by another owner or activation. Each access rechecks its
abort signal, trust and filesystem/thread identity. A callback captured for A
continues to address A or refuses the operation; navigating to B cannot redirect
it. A moved/archived transcript can require resolving a new explicit context.

## Settings and storage

Settings read precedence is **thread override → project override → app/user
value → declared default**. A setter writes only its exact scope. Storage has
no inheritance: an absent thread value returns `undefined`, even if the same
key has project/app data. Omit the context only for app/user values.

Public setting projections omit secrets at every scope. Frontend setting writes
cannot address secret declarations. Backend code retains access to secret
settings. These are trusted in-process modules, not OS-isolated extensions.

All values remain under the app server's `desktop-extension-data/`, namespaced
by owner and canonical project/thread identity. Project and thread records use
hashed filenames. They are not written into repositories or transcripts.
Existing native provider/layout preferences remain separate: app preferences
live in desktop state; window overrides remain window-local.

There is no automatic migration or persistence rollback. An incompatible schema
needs an explicit recovery plan before updating. A failed publication cannot
undo a completed data write.
