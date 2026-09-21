# Deploying the relay

The D1 database already exists and `wrangler.jsonc` carries its id. Everything
below needs a browser or a secret value, so it has to be done by hand.

| Item | Value |
| --- | --- |
| Account | `43557fce17fd00ec09461c12c39dc41a` |
| Zone | `knightcode.dev` = `9eb345a5d81de9d3c8e971208b2117bf` |
| Hostname | `remote.knightcode.dev` |
| D1 | `knightcode-remote` = `89b432a5-032b-42e7-a639-feb2e945da8c` |
| R2 | `knightcode-bug-reports` (bug report bundles) |
| Staging | `knightcode-remote.raghavseth1428.workers.dev` |

## 0. Running it locally first

Nothing below this section touches the internet. Do it before deploying.

### A third OAuth app, for localhost

GitHub matches callbacks exactly and accepts plain `http` for `localhost`, so
local needs its own app at <https://github.com/settings/developers>:

- Homepage: `http://localhost:8787`
- Callback: `http://localhost:8787/auth/callback`

Put its credentials in `apps/remote/.dev.vars` (gitignored, never deployed):

```
SIGNING_SECRET=<openssl rand -base64 32>
GITHUB_CLIENT_ID=<the localhost app's id>
GITHUB_CLIENT_SECRET=<the localhost app's secret>
```

### Start the relay

```bash
cd apps/remote
bun run build
bun run dev:worker
```

`bun run dev:worker` applies any unapplied D1 migrations to the local database
first — without them every `/auth/device` request 500s with `no such table`.

`bun run build` compiles the React app in `web/` to `web/dist`, which is the
assets directory wrangler serves. For UI work run `bun run dev` in a second
terminal instead: Vite serves the app on 5183 with hot reload and proxies
`/api`, `/login` and the room websocket to the Worker on 8787.

`bun run dev:worker` passes `--routes "localhost:8787/*"`, and that is load-bearing.
Wrangler derives the URL the Worker *sees* from the first configured route, so
without the override every request arrives as `remote.knightcode.dev` even
though it came from `127.0.0.1` — the device flow then prints a production
`verification_uri` and OAuth sends a production `redirect_uri`. Overriding the
route is dev-only; `wrangler.jsonc` keeps the real one for deploys.

### Drive it

```bash
# PowerShell, from the repo root, in a second terminal
$env:KNIGHTCODE_REMOTE_RELAY = "http://localhost:8787"
bun run start
```

Then `/remote`. Set the variable per-run rather than in `.env`: left there it
silently points every future session at a relay that is usually not running.

Use **Chrome or Firefox**. The session cookie is `Secure`, and both treat
`http://localhost` as a trustworthy origin and store it; Safari does not, so
sign-in there appears to succeed and then loops back to the landing page.

A phone cannot reach `localhost`. Test the viewer in a second browser profile
(a second window of the same profile shares the cookie and cannot show the 403
path), or run `wrangler dev --tunnel` and register that hostname's callback.
The phone steps in section 5 are worth doing once against the real deploy.

### Local D1

`--local` keeps its own SQLite under `.wrangler/state`, entirely separate from
the deployed database. To inspect it:

```bash
bunx wrangler d1 execute knightcode-remote --local --file ./query.sql
```

`--command` is unreliable through `bunx` on Windows — the quoted argument does
not survive, and wrangler exits claiming neither flag was given. Use `--file`.

## 1. GitHub OAuth app

At <https://github.com/settings/developers>, create an OAuth app:

- Homepage: `https://remote.knightcode.dev`
- Callback: `https://remote.knightcode.dev/auth/callback`

GitHub matches callbacks exactly, so a second app is worth creating for staging
with callback `https://knightcode-remote.raghavseth1428.workers.dev/auth/callback`.

## 2. Secrets

```bash
cd apps/remote
openssl rand -base64 32          # paste this as SIGNING_SECRET
bunx wrangler secret put SIGNING_SECRET
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET

# Comma-separated email addresses allowed to read /bugs. Anyone else, signed in
# or not, gets a 404 there. Filing a report needs no account at all. Matched
# against the verified primary address GitHub reports at sign-in, so an account
# with no verified address never qualifies.
bunx wrangler secret put ADMIN_EMAILS
```

## 2a. The bug report bucket

`/bug` uploads land in a private R2 bucket. It has to exist before the first
deploy, because a Worker whose binding names a missing bucket fails to upload.

```bash
bunx wrangler r2 bucket create knightcode-bug-reports
bunx wrangler r2 bucket lifecycle add knightcode-bug-reports expire-90d bug-reports/   --expire-days 90
bunx wrangler r2 bucket lifecycle list knightcode-bug-reports   # confirm both rules
```

`name` and `prefix` are positionals on `lifecycle add`, not flags. The rule
deletes bundles after 90 days; the D1 rows stay, so `/bugs` keeps listing a
report whose files have expired and answers 404 for its downloads.

The bucket exists (created 2026-09-20) with the rule applied; redo this only on
a fresh account. Never make it public — every read goes through
`/api/bugs/<id>/<file>` so the allowlist check cannot be walked around.

## 3. DNS for `remote`

Do this **before** deploying: a Worker zone route only fires on proxied traffic,
so the hostname needs an orange-cloud record first. Wrangler cannot create it —
its OAuth token carries `zone` read only, which is also why `wrangler.jsonc`
uses a route rather than `custom_domain: true`.

`100::` is the IPv6 discard prefix, the standard placeholder for a hostname that
exists only to be intercepted at the edge; nothing ever reaches the origin.

Via the `cloudflare-api` MCP `execute` tool, or the dashboard:

```js
async () => cloudflare.request({
  method: "POST",
  path: "/zones/9eb345a5d81de9d3c8e971208b2117bf/dns_records",
  body: { type: "AAAA", name: "remote", content: "100::", proxied: true, comment: "Workers route for knightcode-remote" },
})
```

Confirm the result has `"proxied": true`. The apex and `www` records stay
**DNS-only (grey cloud)** for Vercel — `remote` is the only orange one. The two
settings are deliberately opposite; proxying the apex breaks Vercel's TLS.

The record exists (created 2026-09-14); redo this only if it is deleted.

## 4. Migrate and deploy

Deploys run from GitHub, not from a laptop. `.github/workflows/deploy-remote.yml`
applies pending D1 migrations and runs `bun run deploy` on every push to `main`
that changes what ships: `apps/remote` minus its tests and docs, or the wire
protocol in `packages/remote/src/protocol.ts`. To redeploy without a change,
run the workflow from the Actions tab.

It needs one repository secret, `CLOUDFLARE_API_TOKEN`: a token made from the
"Edit Cloudflare Workers" template with **D1: Edit** added, scoped to this
account and the `knightcode.dev` zone. The template already carries **Workers R2
Storage: Edit**, which the bug report bucket binding needs; if the deploy fails
with a permissions error naming R2, the token predates that and needs remaking.

`bun run deploy` builds before it uploads, on purpose: `web/dist` is gitignored
build output and the assets directory is what gets uploaded, so a bare
`wrangler deploy` can ship a stale app — or none at all on a fresh checkout.

If the deploy reports the route was created but requests 522 or hang, the DNS
record from step 3 is missing or grey-cloud.

## 5. Verify end to end

1. `bun run start`, then `/remote`. It prints a verification URL and a code.
2. Open the URL on a phone, sign in with GitHub, enter the code, approve.
3. The terminal prints a `remote.knightcode.dev/r/<id>` link and the footer
   shows `remote 0 viewers`.
4. On the phone open `https://remote.knightcode.dev/` — the session appears in
   the list **without pasting the link**. Tap it.
5. The footer becomes `remote 1 viewer` and a notification appears.
6. Send a prompt from the phone; it appears in the terminal transcript and the
   agent responds in both places.
7. Ask for something long and close the phone tab mid-stream. **The terminal
   keeps streaming untouched.**
8. Drop the machine's network briefly. The agent finishes its turn, the footer
   shows `remote retrying`, then recovers.
9. Sign in as a different GitHub account elsewhere and open the room URL: 403.
10. `/remote stop` clears the footer and the room disappears from the phone.
