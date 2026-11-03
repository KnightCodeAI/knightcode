# Deploying KnightCode Bots

KnightCode Bots runs as one Cloudflare Worker (`apps/bots`) with its Durable
Objects, a container image for the users' computers, and the web app it
serves. `wrangler.jsonc`'s top level is for development only; production is
`--env production`. The **Deploy Bots** workflow
(`.github/workflows/deploy-bots.yml`) deploys it, and runs only when started
by hand. Everything below must exist before its first run. None of it is
created by the repository's checks.

## Cloudflare resources

Create these once in the account, then put their ids into the
`env.production` block of `wrangler.jsonc` where the placeholders are.

| Binding | Kind | Name | Notes |
| --- | --- | --- | --- |
| `DB` | D1 database | `knightcode-bots` | `database_id` goes in the config; migrations in `migrations/` |
| `FILES` | R2 bucket | `knightcode-bots-files` | Files, page exports and computer saves (encrypted per account) |
| `OUTBOUND` | Queue | `bots-outbound` | With the dead-letter queue `bots-outbound-dlq` |
| `KEK` | Secrets Store secret | `bots-kek` | 32 random bytes, base64; `store_id` goes in the config |
| `BOT`, `USER`, `COMPUTER` | Durable Objects | `BotObject`, `UserObject`, `ComputerObject` | SQLite storage (migration `v1`) |
| `ComputerObject` | Container | `computer/Dockerfile` | Built by the deploy; 2 vCPU, 6 GiB, 16 GB disk, up to 100 |
| `EMAIL` | Send Email | | Sends from `*@bots.knightcode.dev` |
| `ASSETS` | Static assets | `web/dist` | Built by the workflow before the deploy |

The workflow's `CLOUDFLARE_API_TOKEN` secret needs edit rights for Workers,
Containers, D1, R2, Queues, Secrets Store and Email Routing, scoped to this
account and the `knightcode.dev` zone.

## Worker secrets

Set each with `bunx wrangler secret put <NAME> --env production` in
`apps/bots`. Never commit any of them.

| Secret | What it is |
| --- | --- |
| `SESSION_SECRET` | Signs sessions, tickets and screen URLs; 32+ random bytes |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth app for sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client for sign-in |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET` | The KnightCode Bots GitHub App |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | The distributed Slack app |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | The KnightCode Bots Telegram bot |
| `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET` | Composio, the long-tail connector source |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLAN_PRICE`, `STRIPE_TOPUP_PRODUCT` | Billing and agent payments |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Bank data |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |

Plain variables (`APP_ORIGIN`, `PAYMENTS_COUNTRIES`, `DESKTOP_ORIGIN`) are in
the config. `ONEPASSWORD_AGENT_SIGNIN` stays unset until that route exists.
No `BOTS_DEV_*` variable may ever be set in production.

## DNS and mail

All records are in the `knightcode.dev` zone.

| Record | Name | Value |
| --- | --- | --- |
| Custom domain | `bots.knightcode.dev` | Attached by the deploy (`routes` in the config) |
| MX | `bots.knightcode.dev` | Added by Email Routing when it is enabled for the subdomain |
| TXT (SPF) | `bots.knightcode.dev` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT (DKIM) | `cf2024-1._domainkey.bots.knightcode.dev` | The key Cloudflare's Email Service shows for the domain |
| TXT (DMARC) | `_dmarc.bots.knightcode.dev` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@knightcode.dev` |

Email Routing for `bots.knightcode.dev`: one catch-all rule, action "Send to a
Worker", Worker `knightcode-bots`. Every bot's address is on this domain, and
the Worker's email handler routes each message to its bot.

## Third-party setup

Each service sends its webhooks to the production origin:

| Service | Endpoint |
| --- | --- |
| GitHub App webhook | `https://bots.knightcode.dev/hooks/github` |
| Slack Events API | `https://bots.knightcode.dev/hooks/slack` |
| Slack OAuth redirect | `https://bots.knightcode.dev/auth/slack/callback` |
| Telegram `setWebhook` (with the secret token) | `https://bots.knightcode.dev/hooks/telegram` |
| Stripe webhook | `https://bots.knightcode.dev/hooks/stripe` |
| Composio webhook | `https://bots.knightcode.dev/hooks/composio` |
| GitHub and Google OAuth callbacks | `https://bots.knightcode.dev/auth/github/callback`, `/auth/google/callback` |

## Human tasks

These need a person, an account owner's decision or a contract, and are not
done by any automation here:

- Create the Cloudflare resources above and fill in their ids.
- Enable Email Routing and the Email Service for `bots.knightcode.dev`, and
  add the SPF, DKIM and DMARC records.
- Register the GitHub OAuth app and the GitHub App, the Google OAuth client
  (with app verification for sensitive scopes), the Slack app and the
  Telegram bot, and set their secrets.
- Open the Composio account and confirm its current pricing and the v3 API
  shapes `src/connectors/composio.ts` uses, including how a toolkit's auth
  config is chosen.
- Get Stripe's agent payments access (shared payment tokens and single-use
  cards); until then purchases are refused, never faked.
- Open the Plaid production account; create the Stripe plan price and top-up
  product.
- Accept the providers' terms and enter any payment details; automation never
  does.

## Deploying

1. Fill in the ids and set every secret.
2. Start **Deploy Bots** from the Actions tab. It applies the D1 migrations,
   builds the web app, then deploys the Worker and the computer image.
3. Check `https://bots.knightcode.dev` signs in, and send a test mail to a
   bot's address.
