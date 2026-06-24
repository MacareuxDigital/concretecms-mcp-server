# Setup & Re-Auth Guide

A step-by-step guide for connecting this MCP server to **any Concrete CMS site**
(Concrete CMS 9.x) from an MCP client such as Claude Desktop, plus the
troubleshooting notes that save the most time.

Throughout this guide, replace the placeholders with your own values:

| Placeholder | Meaning |
|---|---|
| `https://your-site.example` | The site root of your Concrete CMS installation (no trailing slash). |
| `/path/to/concretecms-mcp-server` | The absolute path where you cloned this repo. |
| `YOUR_API_CLIENT_ID` | The Client ID from your API integration (long hex string). |
| `YOUR_API_CLIENT_SECRET` | The Client Secret shown **once** when the integration is created. |

---

## 1. Build the server

```bash
git clone https://github.com/MacareuxDigital/concretecms-mcp-server.git
cd concretecms-mcp-server
npm ci && npm run build
```

This produces `dist/index.js`, which your MCP client launches.

---

## 2. Enable & configure the Concrete CMS API

In your Concrete CMS dashboard:

**API Settings** (Dashboard → System & Settings → API):

- Enable API: ✅
- Enabled Grant Types — all three are required for the OAuth flow this server uses:
  - Client Credentials ✅
  - Authorization Code ✅
  - Refresh Token ✅

**Create an API Integration** (Dashboard → System & Settings → API → Integrations):

- Give it a name (e.g. "Claude").
- **Redirect URI(s)** — enter each on its own line. **Do not** join them with `|`:
  - `http://localhost:3000/callback`  ← this server hardcodes it; **required**
  - Any auto-generated entry (e.g. the API documentation redirect URL) is fine to leave.
- User Consent Level: Standard
- Scopes: select the scopes you want to grant (or All).

After saving, record two values from the integration page:

- **Client ID** — the long hex string (this is `YOUR_API_CLIENT_ID`).
- **Client Secret** — shown **once** at creation (this is `YOUR_API_CLIENT_SECRET`).
  If you lost it, regenerate the secret and update your config.

> Find the list of available scope strings at
> `https://your-site.example/index.php/dashboard/system/api/scopes`.

---

## 3. Allow the Authorization header through to PHP

The REST API/OAuth bearer token is sent in the HTTP `Authorization` header. Some
server stacks (Apache/LiteSpeed) strip it before it reaches PHP. Ensure your
`.htaccess` includes the standard Concrete pretty-URL rewrite **plus** this
pass-through line:

```apache
RewriteCond %{HTTP:Authorization} .
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
```

Without it, authorization may appear to succeed but API calls return 401.

---

## 4. Configure your MCP client

Example for **Claude Desktop**
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "concretecms": {
      "command": "node",
      "args": [
        "/path/to/concretecms-mcp-server/dist/index.js"
      ],
      "env": {
        "CONCRETE_CANONICAL_URL": "https://your-site.example",
        "CONCRETE_API_CLIENT_ID": "YOUR_API_CLIENT_ID",
        "CONCRETE_API_CLIENT_SECRET": "YOUR_API_CLIENT_SECRET",
        "CONCRETE_API_SCOPE": "account:read system:info:read"
      }
    }
  }
}
```

- `CONCRETE_CANONICAL_URL` must be the **bare site root** with **no trailing slash**.
- `CONCRETE_API_SCOPE` is a space-separated list of the scopes you enabled.

Fully quit and reopen the MCP client so it loads the new config.

---

## 5. First-run authorization

On first run (or whenever `.tokens.json` is missing/invalid) the server:

1. starts a local listener on `http://localhost:3000`,
2. opens your browser to the authorize URL with PKCE,
3. waits for you to log in and click **Authorize**,
4. receives the redirect to `http://localhost:3000/callback?code=...`,
5. exchanges the code for tokens and writes **`.tokens.json`**,
6. shuts the local listener down.

> The "can't connect to localhost" page you may see *after* authorizing is
> harmless — the listener has already captured the code and closed. If you saw
> "Authorization Successful," it worked.

Be logged into your site's dashboard as an admin in your **default browser**
before this step so the consent prompt appears immediately.

---

## How auth works (so failures make sense)

The server derives its OAuth endpoints from `CONCRETE_CANONICAL_URL`
(see `src/auth/oidc.ts`):

- authorize: `CONCRETE_CANONICAL_URL` + `/oauth/2.0/authorize`
- token:     `CONCRETE_CANONICAL_URL` + `/oauth/2.0/token`

The redirect URI and local port are hardcoded in `src/auth/oauthFlow.ts`
(`http://localhost:3000/callback`, port `3000`) — which is why that exact
redirect URI must be registered on the integration.

---

## Re-authorizing later

You normally won't need to — the refresh token in `.tokens.json` keeps the
session alive. If you do (revoked access, changed scopes, corrupted tokens):

1. Be logged into `https://your-site.example/dashboard` as admin in your default browser.
2. Delete the stored tokens:
   ```
   rm /path/to/concretecms-mcp-server/.tokens.json
   ```
3. Fully quit the MCP client (Cmd+Q on macOS — not just close the window) and reopen.
4. Approve the scopes when the browser prompt appears.

---

## Gotchas that cost the most time

1. **Wrong canonical URL.** `CONCRETE_CANONICAL_URL` must be the bare site root.
   - Using a sub-path (e.g. an API documentation/redirect URL) means the server
     appends `/oauth/2.0/authorize` to a dead path → Concrete's themed
     "Page Not Found."
   - A **trailing slash** yields `//oauth/2.0/authorize` and also fails.

2. **Missing grant types.** `unsupported_grant_type` errors mean Authorization
   Code and/or Refresh Token aren't enabled in API Settings.

3. **Wrong Client ID.** Use the long hex **Client ID** from the integration page —
   not a UUID found in a redirect/documentation URL. The wrong value yields
   `invalid_grant` / "The user credentials were incorrect" at the token step.

4. **Missing or malformed redirect URI.** `http://localhost:3000/callback` must be
   registered on the integration exactly. Enter redirect URIs one per line — do
   not join them with `|`.

5. **Config not reloading.** Editing the config while a stale server process is
   running keeps the old values. A full quit (Cmd+Q) + relaunch fixes it.

6. **Authorization header stripped.** If auth succeeds but API calls 401, you're
   likely missing the `.htaccess` `HTTP_AUTHORIZATION` pass-through (see step 3).

---

## Verifying the connection

Run the `get-system-info` tool from your MCP client. A healthy response returns
your Concrete version, PHP version, and web server — e.g. Concrete 9.5.2,
PHP 8.1, Apache/LiteSpeed.

> **Production hygiene tip:** while you're in there, check that you're on a
> supported PHP version (8.1–8.3 for Concrete 9.5.x; PHP 8.0 is end-of-life) and
> that caching (Block, Overrides, Full Page) is enabled for production sites.
