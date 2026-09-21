# `/bug` — bug report intake on remote.knightcode.dev

Status: design
Date: 2026-09-21
Builds on: the relay, accounts and sign-in already in `apps/remote`, and the
web app in `apps/remote/web`. Deployment mechanics: `../DEPLOYING.md`.

## 0. Mandatory reading

Read these before writing any code. The intake is bolted onto a Worker that is
already deployed and already carries an authorisation model; none of it is
being redesigned here.

- `apps/remote/src/worker.ts` — routing, `currentAccount()`, `appShell()`.
- `apps/remote/src/accounts.ts` — `Env`, the session cookie, `Account`.
- `apps/remote/wrangler.jsonc` — why the route is a zone route and not a
  custom domain, and why `run_worker_first` and `html_handling: "none"` are
  load-bearing.
- `../DEPLOYING.md` — what has to be done by hand and why.
- `packages/cli/src/core/bug-report.ts` — `BugReportBundle`, `bugReportFiles()`,
  the redaction rules.
- `packages/cli/src/modes/interactive/bug-report.ts` — the dialog and its two
  destinations.

## 1. Problem

`/bug` builds a report bundle locally: `report.json` (version, runtime, OS,
terminal, model and provider configuration, extensions, settings, with API
keys, header values, URL credentials and the tracking id stripped),
`diagnostics.json` (provider and runtime errors across the session, plus
recorded crashes), and optionally `session.jsonl` and a model-written
`summary.md`.

It can do exactly one thing with that bundle: write it to a zip in the current
directory and ask the user to send it somewhere. There is nowhere to send it.
The dialog's other destination, **Upload Report**, has no endpoint behind it.

## 2. Scope

In:

- `POST /v1/bug-reports` on `remote.knightcode.dev`, anonymous, with explicit
  size, shape and rate limits.
- Each uploaded file stored as its own R2 object; one D1 row per report.
- `/bugs` in the existing web app, behind the existing sign-in plus an admin
  allowlist: newest-first list with a download link per stored file.
- `/bug`'s **Upload Report** wired to that endpoint, with **Export as Zip**
  unchanged and still the fallback when an upload fails.

Out:

- A second hostname, a second Worker, a second D1 database. The endpoint is a
  path on the service that is already running.
- Cloudflare Access. The app already has GitHub sign-in and a signed session
  cookie; a second identity system to protect one page is not worth its
  configuration surface.
- Attribution. Reports are always anonymous; see Decisions.
- Server-side zipping. Files are stored and served individually.
- Notification, triage, status, replies, search, or any write path from the
  page. Reading is the whole of v1.

## 3. Wire contract

```
POST https://remote.knightcode.dev/v1/bug-reports
Content-Type: multipart/form-data
User-Agent: knightcode/<version>

  report.json        application/json       required
  diagnostics.json   application/json       required
  session.jsonl      application/x-ndjson   optional
  summary.md         text/markdown          optional

200 { "ok": true, "bug_report": { "id": "<uuid>" } }
4xx { "ok": false, "error": "<code>", "description": "<sentence>" }
```

One form field per file, named after the file, which is what
`bugReportFiles()` already produces. The client reads `error` or `description`
out of a failure body and shows it, then offers the zip fallback.

Refusals, all with `ok: false`:

| Condition | Status | `error` |
| --- | --- | --- |
| Not `multipart/form-data` | 400 | `bad_request` |
| A field name outside the four above | 400 | `unexpected_file` |
| `report.json` or `diagnostics.json` missing | 400 | `missing_file` |
| `report.json` is not a JSON object | 400 | `bad_report` |
| `User-Agent` does not match `knightcode/<version>` | 400 | `bad_client` |
| Total body over 10 MB | 413 | `too_large` |
| `session.jsonl` over 8 MB | 413 | `too_large` |
| Rate limit exceeded | 429 | `rate_limited` |

The user-agent check is not security; it is a cheap filter that keeps
scanners and stray crawlers out of the bucket. It is stated as such in the
code comment so nobody later mistakes it for one.

## 4. Storage

R2 bucket `knightcode-bug-reports`, binding `BUGS`, private. Keys:

```
bug-reports/<yyyy>/<mm>/<id>/report.json
bug-reports/<yyyy>/<mm>/<id>/diagnostics.json
bug-reports/<yyyy>/<mm>/<id>/session.jsonl    (when present)
bug-reports/<yyyy>/<mm>/<id>/summary.md       (when present)
```

D1 migration `0004_bug_reports.sql`, in the existing `knightcode-remote`
database:

```sql
CREATE TABLE bug_reports (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  prefix         TEXT NOT NULL,
  client_id      TEXT,
  version        TEXT,
  platform       TEXT,
  arch           TEXT,
  runtime        TEXT,
  description    TEXT,
  has_session    INTEGER NOT NULL DEFAULT 0,
  has_summary    INTEGER NOT NULL DEFAULT 0,
  crash_count    INTEGER NOT NULL DEFAULT 0,
  size_bytes     INTEGER NOT NULL
);
CREATE INDEX bug_reports_created ON bug_reports (created_at DESC);
```

`id` is minted by the Worker and is what the reporter is shown. `client_id` is
the id the bundle gave itself, kept so a report can be matched to the entry
`/bug` writes into the user's own session. `prefix` is the R2 key prefix, so
the download route never rebuilds a path from a date.

The Worker reads `report.json` to fill the columns and stores every file
byte-for-byte. It never parses `session.jsonl`: it is the largest file, it is
attacker-controlled, and nothing on the page needs it structured.

A malformed-but-JSON `report.json` is still stored, with the columns it could
not fill left null. Losing a report because its metadata was odd is worse than
a sparse row.

Retention: an R2 lifecycle rule deletes objects 90 days after upload. Rows are
kept — they are a few hundred bytes — so an expired report still appears in the
list and its downloads answer 404. The list does not label it as expired: that
would cost an R2 `head` per row on every page load, and the row's age already
says it.

## 5. Rate limiting

A `ratelimits` binding, keyed on the client IP:

```jsonc
"ratelimits": [
  { "name": "BUG_RATE_LIMIT", "namespace_id": "1001",
    "simple": { "limit": 3, "period": 60 } }
]
```

`period` accepts only `10` or `60` (`node_modules/wrangler/config-schema.json`,
`RawConfig.properties.ratelimits`), so a ten-minute window cannot be expressed
and three per minute per IP is the closest useful shape. A person filing a bug
sends one; a flood is capped at 3/min/IP and 10 MB each.

The limiter is checked before the body is read, so a refused request never
costs a bucket write.

## 6. The page

`GET /bugs` resolves to the existing app shell. `GET /api/bugs` returns the
rows, `GET /api/bugs/:id/:file` streams one object out of R2. Both are
refused with 404 — not 403 — for anyone who is not an admin, so the route does
not confirm it exists.

Admin is an `ADMIN_EMAILS` secret, a comma-separated list of addresses compared
against the address on the signed-in account, trimmed and case-folded on both
sides because the secret is hand-edited.

Emails rather than GitHub logins, which costs the `user:email` scope and one
extra API call at sign-in, and gains an identity that survives a username
change. What makes it safe is `verified`: anyone can add someone else's address
to their own GitHub account, but GitHub will not let a second account verify an
address already verified elsewhere. So only a `primary` **and** `verified`
address is stored, migration `0005` holds it on `accounts`, and an account with
no stored address is never an admin — an account that signed in before the
column existed has none until it signs in again, which denies access rather
than granting it.

The list shows, per report: relative age, description (or "no description"),
version, platform, size, and badges for transcript, summary and crash count,
with a download link per stored file including `session.jsonl`.

Not in v1, deliberately: rendering `report.json` or `summary.md` inline. Both
are one click away already, and fetching them per row to display them would
turn a list of 200 reports into 400 R2 reads. Add it behind a per-report
expansion if reading reports in the browser proves worth the round trip.

## 7. CLI changes

These files are part of the in-flight CLI resync group and are not yet
committed; the changes below land in that group.

- `packages/cli/src/core/bug-report-upload.ts` — posts to
  `${endpoint}/v1/bug-reports` where `endpoint` is `KNIGHTCODE_BUG_ENDPOINT`
  or `https://remote.knightcode.dev`. No `Authorization` header.
- `packages/cli/src/modes/interactive/bug-report.ts` — drops the provider
  token lookup; the confirmation line names the endpoint host.
- `packages/cli/src/core/bug-report.ts` — archive name
  `knightcode-bug-report-<id>.zip`.
- `packages/cli/docs/sessions.md`, `environment-variables.md` — the reporting
  section says reports go to the KnightCode maintainers, documents
  `KNIGHTCODE_BUG_ENDPOINT`, and keeps the table of what each file contains.

## 8. Decisions

**One host, not two.** An earlier draft put the public intake on
`bugs.knightcode.dev` and a dashboard on `app.knightcode.dev`, with
Cloudflare Access over the second. Rejected: two DNS records that wrangler's
token cannot create, a second Worker, a second D1, an Access application whose
misconfiguration either breaks every upload or publishes the reports, and a
JWT verifier to guard against the `workers.dev` hostname walking past Access.
All of it to serve one page and one POST that the running Worker can answer
today.

**Anonymous, with limits.** Requiring sign-in at the moment someone has hit a
bug is where bug reports go to die. The cost is bounded by section 5.

**No attribution.** There is no KnightCode account for CLI users, and binding
a bug report to a third-party inference login would be worse than anonymous.
If follow-up ever matters, the description field is where a reporter can leave
a handle.

**Files, not archives.** Storing the four parts separately means no zip
library in the Worker, no re-zip on download, and a page that can render
`report.json` and `summary.md` without unpacking anything.

## 9. Required tests

`apps/remote/test/bugs.test.ts`, under `@cloudflare/vitest-pool-workers` as
the existing Worker tests are:

- A good upload returns `{ ok: true }` with an id, writes one object per
  supplied file, and one row whose columns match `report.json`.
- Each refusal in the section 3 table returns its status and `error`, and
  writes nothing to R2 or D1.
- An oversize `session.jsonl` is refused even when the total is under 10 MB.
- A `report.json` that parses but has no recognisable fields is stored, with
  null columns.
- `GET /api/bugs` and `GET /api/bugs/:id/:file` are 404 signed out, 404 for a
  signed-in account whose address is absent from `ADMIN_EMAILS`, and 200 for one
  present. Also 404 for an account with no stored address at all.
- A report whose objects are gone still lists, and its downloads 404.
- A body that exceeds the cap fails while streaming, before `formData()` parses
  it, however small its `Content-Length` claims to be.
- A failure after the first object is written leaves nothing in the bucket.

`packages/cli/test/bug-report.test.ts`:

- The upload posts one form field per bundle file to
  `<endpoint>/v1/bug-reports`, with no `Authorization` header.
- `KNIGHTCODE_BUG_ENDPOINT` overrides the host.
- A non-`ok` body surfaces `description`, then `error`, then the status text.

## 10. Validation

```bash
cd apps/remote
wrangler d1 migrations apply knightcode-remote --local
bun run typecheck
bun run test
bun run build && bun run dev:worker

# in another shell, against the local worker
curl -sS -X POST http://localhost:8787/v1/bug-reports \
  -H 'user-agent: knightcode/0.0.0' \
  -F report.json=@report.json \
  -F diagnostics.json=@diagnostics.json
```

```bash
# no second hostname, no Access, no second worker crept back in
rg -n 'app\.knightcode\.dev|bugs\.knightcode\.dev|cloudflareaccess' apps packages
# expect: no matches

# the endpoint is not wired to the inference gateway
rg -n 'RADIUS' packages/cli/src/core/bug-report-upload.ts
# expect: no matches
```

## 11. Deployment

Mechanics unchanged (`DEPLOYING.md`); no new DNS record, no new OAuth app.
Three steps, all one-off:

From `apps/remote`, so wrangler reads the Worker name from `wrangler.jsonc`.
`name` and `prefix` are positionals on `lifecycle add`, not flags:

```bash
wrangler r2 bucket create knightcode-bug-reports
wrangler r2 bucket lifecycle add knightcode-bug-reports expire-90d bug-reports/ \
  --expire-days 90
wrangler secret put ADMIN_EMAILS
```

Then apply migration 0004 to the remote D1 before `wrangler deploy`.

Order against the resync: deploy the Worker first, then land the CLI group, so
no release ever ships a `/bug` whose upload points at nothing.

## 12. Stop condition

Bug report intake is complete when:

- A `/bug` upload from a local build lands in R2 and D1 and returns an id.
- Every refusal in section 3 is covered by a test that fails without its check.
- `/bugs` lists that report for an allowlisted login and 404s for everyone
  else, signed in or not.
- `bun run typecheck` and `bun run test` are clean in `apps/remote`.
- Both greps in section 10 return no matches.
