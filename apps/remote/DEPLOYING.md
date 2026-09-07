# Deploying the relay

The D1 database already exists and `wrangler.jsonc` carries its id. Everything
below needs a browser or a secret value, so it has to be done by hand.

| Item | Value |
| --- | --- |
| Account | `43557fce17fd00ec09461c12c39dc41a` |
| Zone | `knightcode.dev` = `9eb345a5d81de9d3c8e971208b2117bf` |
| Hostname | `remote.knightcode.dev` |
| D1 | `knightcode-remote` = `89b432a5-032b-42e7-a639-feb2e945da8c` |
| Staging | `knightcode-remote.raghavseth1428.workers.dev` |

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
```

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

## 4. Migrate and deploy

```bash
cd apps/remote
bunx wrangler d1 migrations apply knightcode-remote --remote
bun run build:client
bunx wrangler deploy
```

`build:client` is required: `client/app.js` and `client/rooms.js` are gitignored
build output, and the assets directory is what gets uploaded.

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
