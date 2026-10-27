# cloudflare-maintenance-worker

[日本語](README.ja.md)

A Cloudflare Worker that answers with `503` and a maintenance page while you run heavy migrations or other database work, plus the scripts that switch maintenance on and off.

The Worker normally receives no traffic at all. Maintenance starts when Workers Routes for your hosts are attached to it, and ends when they are detached. The `maintenance-worker on` and `off` commands do this through the Cloudflare API. Routes are deliberately left out of `wrangler.jsonc`: if they were there, every `wrangler deploy` would attach them and a deploy alone would take the site down. Deploying the Worker and entering maintenance are separate actions on purpose.

## What it does

- It answers ordinary requests with the maintenance page as `503`, with `Retry-After` (3600 seconds by default) and `Cache-Control: no-store`, so neither Cloudflare nor browsers keep the page.
- When some requests need a different answer, such as a JSON error for API clients or a `409` for Inertia.js visits, you can plug in functions that give it. See [Custom responses](#custom-responses).
- Operators get through with a passphrase or from an allowed IP. Opening any URL with `?maintenance_bypass=<passphrase>` redirects to the same URL without the parameter and sets a cookie that is valid for 12 hours. The redirect keeps the passphrase from staying in the address bar.

The name of the parameter, `maintenance_bypass`, is not a secret. Anyone may know it and it lets nobody in without the passphrase. The passphrase is compared in constant time, and the cookie holds a hash derived from it, never the passphrase itself. Because the cookie value is derived from the passphrase and the server keeps no expiry list, changing the passphrase invalidates every cookie issued so far. If no passphrase is set, nobody gets through by passphrase or cookie: the Worker fails closed.

`on` refuses to start if another Worker already holds one of the same route patterns, and changes nothing. If another Worker holds a narrower route on one of your hosts (for example `app.example.com/api/*`), those paths keep serving during maintenance, so `on` and `status` print a warning about them.

Invocation logs are turned off in `wrangler.jsonc` because they record the request URL, which contains the passphrase in plain text when an operator uses it. Do not turn them back on.

## Setting up

The recommended setup keeps only your configuration in your repository and installs the code as a dependency. You need Node 22 or later and pnpm. npm works too, but it takes options such as `--dry-run` for itself, so put `--` before the environment name: `npm run deploy -- develop --dry-run`.

Create a directory with these four files.

`package.json`:

```json
{
  "name": "my-maintenance",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --env develop",
    "deploy": "maintenance-worker deploy",
    "on": "maintenance-worker on",
    "off": "maintenance-worker off",
    "status": "maintenance-worker status"
  },
  "devDependencies": {
    "cloudflare-maintenance-worker": "github:second-fiddle-jp/cloudflare-maintenance-worker#v0.2.0",
    "wrangler": "4.123.0"
  }
}
```

`src/index.js`, which only re-exports the Worker (to answer some requests your own way, see [Custom responses](#custom-responses)):

```js
export { default } from 'cloudflare-maintenance-worker'
```

`wrangler.jsonc` and `maintenance.config.json`: copy the samples at the root of this repository and replace the names and hosts. They are described under [Configuration](#configuration).

Then install and log in to wrangler:

```bash
pnpm install
pnpm exec wrangler login
```

Pin wrangler to an exact version in your own `devDependencies`. The scripts run the wrangler you installed.

You can also clone this repository and edit the samples in place. All commands below work the same in the clone, because its own `package.json` defines the same scripts.

## Configuration

Values that belong to your site live in two files: the vars in `wrangler.jsonc` and `maintenance.config.json`. The code has no site-specific values.

### Worker vars and secrets

Write vars under `env.<environment>.vars` in `wrangler.jsonc`. wrangler does not inherit top-level `vars` into environments, so write every var in every environment even when the value is the same. Write values as strings; numbers and booleans are converted to strings, so `"RETRY_AFTER": 120` works the same as `"120"`.

| Name | Meaning | When unset |
|---|---|---|
| `RETRY_AFTER` | Seconds to put in `Retry-After` | `3600` |
| `BYPASS_COOKIE` | Name of the bypass cookie. Environments that share a cookie domain need different names | `maintenance_bypass` |
| `COOKIE_DOMAIN` | `Domain` of the bypass cookie, such as `.example.com`, so one cookie works across subdomains | No `Domain`: the cookie works only on the host where the passphrase was used |
| `BRAND` | Brand name shown on the page and appended to the title as ` \| <BRAND>` | No brand is shown |
| `PAGE_LANG` | The page's `lang` attribute | `en` |
| `PAGE_TITLE` | The page title | `Under maintenance` |
| `PAGE_HEADING` | The page heading | `We are currently down for maintenance` |
| `PAGE_MESSAGE` | The text under the heading. Newlines become `<br>` | A two-line apology asking visitors to try again later |
| `BYPASS_SECRET` (secret) | The passphrase | No passphrase or cookie gets through |
| `ALLOW_IPS` (secret) | IPs let through during maintenance (comma-separated) | No IP is let through |

Values inserted into the page are HTML-escaped, so a `<` in a var never becomes a tag. To change more than the text, edit the HTML and CSS in `src/page.js` (in a clone) or render your own page. The HTML is not a separate file because importing `.html` as a Worker module would break `node --test`.

### Custom responses

To answer some requests differently during maintenance, pass functions to `createWorker` in `src/index.js`. Each function receives `(request, env, { headers })`. If it returns a `Response`, that is the answer; if it returns `undefined`, the request goes on to the next function and finally to the maintenance page. The functions are called in order. `headers` holds the `Cache-Control` and `Retry-After` the maintenance page uses. Requests from operators, who get through with the cookie or an allowed IP, never reach the functions.

The example below makes Inertia.js visits reload the whole page, and gives a JSON-RPC error to an API host.

```js
import { createWorker } from 'cloudflare-maintenance-worker'

// A 503 HTML page returned to an Inertia XHR shows up inside a modal, so make the client reload the whole page with 409
const inertia = (request) =>
  request.headers.has('X-Inertia')
    ? new Response(null, { status: 409, headers: { 'X-Inertia-Location': request.url, 'Cache-Control': 'no-store' } })
    : undefined

// API clients cannot read a page, so give them a JSON-RPC error
const jsonRpc = (request, env, { headers }) =>
  new URL(request.url).hostname === 'api.example.com'
    ? Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Service under maintenance' }, id: null }, { status: 503, headers })
    : undefined

export default createWorker({ respond: [inertia, jsonRpc] })
```

### maintenance.config.json

This file tells the route scripts which zone to use and which route patterns to attach for each environment.

```json
{
  "zone": "example.com",
  "environments": {
    "develop": { "patterns": ["dev.example.com/*"] },
    "production": { "patterns": ["example.com/*", "www.example.com/*"] }
  }
}
```

Patterns are attached in order. List each host explicitly rather than using a wildcard such as `*.example.com/*`, which would also stop hosts you did not mean to stop, such as a public storage bucket.

Keep the environment names the same as the `env` keys in `wrangler.jsonc`. The Worker name for each environment is `<name>-<env>` from `wrangler.jsonc` (or the `name` an env overrides), and the scripts derive it the same way. An environment that exists only in `maintenance.config.json`, or has no patterns, stops the scripts with a reason, but only when you operate on that environment. An environment that exists only in `wrangler.jsonc` produces a warning and nothing else. This way a mistake in an unrelated environment never blocks `off` or `status` in the middle of maintenance.

The scripts read `wrangler.jsonc` without wrangler. Line comments, block comments and trailing commas are all accepted.

## Deploying and registering secrets

Deploy with the `deploy` script and an environment name. Plain `wrangler deploy` would create a Worker named after the top-level `name` with no vars, so `deploy` refuses to run without an environment name, or with an empty one. `pnpm deploy` is a built-in pnpm command, so always write `pnpm run deploy`. Options for `wrangler deploy`, such as `--dry-run`, go after the environment name (`pnpm run deploy develop --dry-run`; with npm, `npm run deploy -- develop --dry-run`).

```bash
pnpm run deploy develop
pnpm run deploy production
```

Deploying attaches no routes, so the site keeps serving normally.

Register the passphrase and the allowed IPs as Worker secrets after the first deploy. If the Worker does not exist yet, `wrangler secret put` asks interactively whether to create it.

```bash
pnpm exec wrangler secret put BYPASS_SECRET --env production
pnpm exec wrangler secret put ALLOW_IPS --env production
```

Use a different passphrase for each environment, generated with `openssl rand -hex 32`. Hex characters need no URL encoding. Change the passphrase before every maintenance window; that is what invalidates the cookies handed out last time.

## The API token for routes

Attaching and detaching routes calls the Cloudflare API directly, so create a dedicated API token with two permissions, Zone → Workers Routes: Edit and Zone → Zone: Read, limited to your zone. Pass it in the `CLOUDFLARE_API_TOKEN` environment variable. To keep it out of your shell history, read it instead of typing it on the command line:

```bash
read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

wrangler also uses `CLOUDFLARE_API_TOKEN` when it is set, ahead of your `wrangler login` session. This token has no account permissions, so with it exported, `deploy` and `wrangler secret put` stop with "Failed to automatically retrieve account IDs". Run wrangler commands without the variable:

```bash
env -u CLOUDFLARE_API_TOKEN pnpm run deploy production
```

## Entering and leaving maintenance

First check that the Worker is deployed in that environment, that the passphrase has been changed for this window, and that the site is currently serving normally. `status` should report that there are no maintenance routes.

```bash
pnpm run status production
```

Enter maintenance. From here on, visitors get `503`.

```bash
pnpm run on production
```

If another Worker holds the same pattern, `on` stops without changing anything. If it fails part way, it counts the routes again and tells you whether none, some or all of them were attached. When only some are attached, check with `status` and run `off` if needed. If the Worker has not been deployed yet, no route is attached and `on` tells you to deploy first.

Operators then open `https://<host>/?maintenance_bypass=<passphrase>` to get the cookie, or work from an IP listed in `ALLOW_IPS`. IPv6 addresses change often, so register IPv4 addresses or use the cookie.

Remember that the Worker only stops HTTP traffic from outside. Queue workers, cron jobs and schedulers on your servers keep running, so stop them yourself if your work needs it.

When the work is done, leave maintenance and confirm:

```bash
pnpm run off production
pnpm run status production
```

`status` should again report no maintenance routes. Open the site in a browser without the cookie, such as a private window, to confirm it serves normally.

Webhook senders and uptime monitors also receive `503` during maintenance. Most webhook senders retry, but check their retry limits if the window is long.

### Putting only some hosts into maintenance

To stop only some sites of an environment, give their hosts to `on` with `--host`. Only the patterns of those hosts in `maintenance.config.json` are attached. The host is compared with the part of each pattern before the first `/`, exactly and case-sensitively, so `--host example.com` does not select `app.example.com`. For a wildcard pattern such as `*.example.com/*`, pass the same text and quote it in the shell (`--host '*.example.com'`). Repeat `--host` for several hosts, and run `on --host` again later to add another host.

```bash
pnpm run on production --host app.example.com
pnpm run status production
```

`status` then reports, for example, `In maintenance: 1 / 3 routes` and lists the attached routes. `off` takes no `--host` and always detaches every route of the Worker, so a single `off production` ends a partial maintenance too. A host that is not in the patterns of the environment stops `on` before anything is changed.

Stopping only some hosts is safe only for work that is confined to those sites. If the sites share a database, the sites left running keep using it during the work.

## Trying it locally

Put the secrets in `.dev.vars` next to `wrangler.jsonc` and start the Worker:

```
BYPASS_SECRET=<passphrase>
ALLOW_IPS=<allowed IP>
```

```bash
pnpm run dev
curl -i http://localhost:8787/
```

`dev` runs with the vars of the `develop` environment. To check a custom response, send a request that matches its condition, for example with `-H 'X-Inertia: true'` or a `Host` header.

## Tests

```bash
node --test
```

The tests use Node's standard API only and need no install.

## License

[MIT](LICENSE)
