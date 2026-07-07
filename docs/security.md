# Security

This document describes how the Concrete CMS MCP server stores credentials and how to use it safely in local and remote deployments.

## What is stored

Each authorized CMS user has two token files under `TOKEN_DIR` (default: `~/.concretecms-mcp/tokens`):

| File | Contents |
|------|----------|
| `{userId}.tokens.json` | Access token, refresh token, expiry, `obtained_at`, CMS user ID |
| `{userId}.client.json` | OAuth client parameters (redirect URI, scope, PKCE state) |

Legacy combined `{userId}.json` files are migrated to the split format on load.

These tokens grant API access with the **same permissions as the CMS user who authorized**.

## Token directory

Default location:

```
~/.concretecms-mcp/tokens/
```

Override with the `TOKEN_DIR` environment variable. Recommended for local stdio mode so tokens stay outside your repository.

### Cleanup

Remove all tokens for a user:

```bash
rm -f ~/.concretecms-mcp/tokens/{userId}.tokens.json \
      ~/.concretecms-mcp/tokens/{userId}.client.json \
      ~/.concretecms-mcp/tokens/{userId}.auth.lock
```

Remove stale locks and tokens expired more than 30 days:

```bash
npm run cleanup:tokens
```

Or after build:

```bash
node scripts/cleanup-tokens.mjs
```

## Local stdio mode (Mode A)

When Claude Desktop spawns the server locally (`TRANSPORT_TYPE=stdio`, default):

- A single user key `local` is used (override with `CONCRETE_USER_ID`)
- Legacy `.tokens.json` in the project root is migrated to `~/.concretecms-mcp/tokens/local.*` on startup
- OAuth runs **lazily** on the first tool call (not at process startup)
- Concurrent OAuth flows are coordinated via per-user lockfiles
- `TOKEN_ENCRYPTION_KEY` is optional; a warning is logged if unset
- Token files are written with mode `0600`

### Recommendations

- Do not commit token files or share them
- Use `TOKEN_ENCRYPTION_KEY` on shared development machines
- Set `TOKEN_DIR` explicitly if you prefer a custom location

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Remote HTTP mode (Modes B and C)

When the server runs remotely (`TRANSPORT_TYPE=http`):

- `TOKEN_ENCRYPTION_KEY` is **required** — tokens are encrypted at rest (AES-256-GCM)
- `MCP_API_KEY` or `MCP_API_KEYS` is **required** — clients must authenticate to `/mcp` and OAuth admin routes
- Each CMS user authorizes separately; tokens are stored per user ID
- `TOKEN_DIR` must not be world-writable; run the service as a dedicated OS user
- `/oauth/start` returns `409` if an OAuth flow is already in progress for that user

### Client authentication

Remote clients must send:

```
Authorization: Bearer <MCP_API_KEY>
X-Concrete-User-Id: <cms_user_id>
```

If using `MCP_API_KEYS` with a user-bound key, the `X-Concrete-User-Id` header is optional:

```json
{"personal-desktop-key": 42, "dashboard-backend-key": null}
```

- A numeric value binds the API key to a fixed CMS user (personal remote clients)
- `null` requires `X-Concrete-User-Id` on each request (dashboard mode)

### Trust model

The MCP server trusts the holder of `MCP_API_KEY` to pass the correct `X-Concrete-User-Id`. The API key must live **server-side** (CMS dashboard backend or personal env config), never in a browser.

CMS user IDs are sequential integers and are **not secret** — security relies on API key protection and per-user OAuth tokens.

### Revoking access

Per user:

```bash
curl -X POST -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/revoke?user_id=42"
```

Or delete the user's token files on the server and restart if needed.

## OAuth routes

| Route | Authentication |
|-------|----------------|
| `/oauth/start` | `MCP_API_KEY` required (http mode) |
| `/oauth/status` | `MCP_API_KEY` required |
| `/oauth/revoke` | `MCP_API_KEY` required |
| `/oauth/callback` | Public (CMS redirect; protected by PKCE) |
| `/health` | Public |
| `/mcp` | `MCP_API_KEY` + user context required |

Rate limiting applies to OAuth routes (10 requests/minute per IP by default).

## Token refresh

Access tokens are refreshed automatically when within 60 seconds of expiry (`TOKEN_REFRESH_BUFFER_MS`). The `obtained_at` timestamp records when tokens were last issued or refreshed.

## Future improvements

OS keychain storage (macOS Keychain, Linux libsecret) may be added as an alternative to encrypted files. Track as a follow-up enhancement.
