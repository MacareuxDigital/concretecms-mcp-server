# Connect Local MCP Clients to a Remote Server

Use this guide when a **desktop MCP client** (ChatGPT, Claude Desktop, or another Streamable HTTP client) should talk to a Concrete CMS MCP server you already host remotely.

For deploying the remote server, see the **[Remote MCP Server Guide](remote-server.md)**.

For running the MCP server as a local stdio process (Claude Desktop spawning `node dist/index.js`), see the **[main README](../README.md)**.

For building your own HTTP agent or CMS package, see the **[MCP Client Developer Guide](mcp-client-guide.md)**.

## Prerequisites

1. A remote MCP server with `TRANSPORT_TYPE=http` and a public HTTPS URL
2. `/health`, `/mcp`, and `/oauth/*` reachable through your reverse proxy
3. An MCP API key (`MCP_API_KEY` or an entry in `MCP_API_KEYS`)
4. Your Concrete CMS user ID (Dashboard → members, or the ID you pass to `/oauth/start`)

Confirm the server is up:

```bash
curl https://mcp.example.com/health
```

Expected:

```json
{ "status": "healthy" }
```

If you use `PATH_PREFIX=/ccm-mcp`, include that prefix in every path below (for example `https://cms.example.com/ccm-mcp/mcp`).

## Authorize your CMS user first

Desktop clients authenticate to the **MCP** server with an API key. They do **not** run Concrete CMS OAuth for you.

Authorize once per CMS user (or again after revoke / token loss):

```bash
export MCP_SERVER_URL=https://mcp.example.com
export MCP_API_KEY=your-mcp-api-key
export CMS_USER_ID=1

# Open the Location URL in a browser, sign in as that CMS user, approve scopes
curl -s -D - -o /dev/null -H "Authorization: Bearer $MCP_API_KEY" \
  "$MCP_SERVER_URL/oauth/start?user_id=$CMS_USER_ID"
```

Confirm:

```bash
curl -s -H "Authorization: Bearer $MCP_API_KEY" \
  "$MCP_SERVER_URL/oauth/status?user_id=$CMS_USER_ID"
```

Expected:

```json
{ "userId": 1, "authenticated": true, "expiresAt": 1710000000000 }
```

Until `authenticated` is `true`, tool calls from ChatGPT or Claude will fail even if the MCP connector connects.

To disconnect later:

```bash
curl -X POST -H "Authorization: Bearer $MCP_API_KEY" \
  "$MCP_SERVER_URL/oauth/revoke?user_id=$CMS_USER_ID"
```

## Headers every `/mcp` request needs

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <MCP_API_KEY>` |
| `X-Concrete-User-Id` | Your Concrete CMS user ID (e.g. `1`) |

### Optional: user-bound API key

If you prefer not to send `X-Concrete-User-Id`, configure a personal key on the MCP server:

```bash
MCP_API_KEYS={"chatgpt-personal":1}
```

Restart the MCP service. Clients then only need:

```
Authorization: Bearer chatgpt-personal
```

A numeric value binds the key to that CMS user. Prefer a dedicated personal key for desktop clients rather than sharing a dashboard backend key. See the **[Security Guide](security.md)**.

## ChatGPT desktop (Streamable HTTP)

Verified against ChatGPT desktop custom MCP connectors (Plugins → MCPs).

1. Open **Settings → Plugins → MCPs** (or the equivalent Integrations / Developer Mode path in your build).
2. Choose **Connect to a custom MCP**.
3. Fill in:

| Field | Value |
|-------|--------|
| Name | Concrete CMS (or any label) |
| Type | **Streamable HTTP** (not STDIO) |
| URL | `https://mcp.example.com/mcp` |

4. Authentication and headers:

   - Prefer **Bearer token env var** (for example `MCP_BEARER_TOKEN`) and put the API key in that environment variable — do not paste long-lived secrets into screenshots or shared configs.
   - Add header `X-Concrete-User-Id` with your CMS user ID.
   - **Do not** set both a Bearer-token env var **and** a manual `Authorization` header. That duplicates auth and can break the connector.

5. Save, enable the connector in a chat, and ask something that needs Concrete CMS (for example system info or list pages).

## Claude Desktop via `mcp-remote`

Claude Desktop’s `mcpServers` config spawns local processes; it does not open remote HTTP MCP URLs directly. Use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "concretecms-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.example.com/mcp",
        "--header",
        "Authorization: Bearer ${MCP_API_KEY}",
        "--header",
        "X-Concrete-User-Id: 1"
      ],
      "env": {
        "MCP_API_KEY": "your-mcp-api-key"
      }
    }
  }
}
```

Replace the URL, user ID, and API key. Restart Claude Desktop after editing the config.

This is separate from **local stdio** mode in the [main README](../README.md), where Claude spawns `node dist/index.js` on your machine and stores tokens under `~/.concretecms-mcp/`.

## Other Streamable HTTP clients

Any client that supports remote Streamable HTTP MCP can use the same endpoint and headers:

- URL: `https://mcp.example.com/mcp`
- `Authorization: Bearer <MCP_API_KEY>`
- `X-Concrete-User-Id: <cms_user_id>` (unless using a user-bound key)

Authorize the CMS user on the server first, as above.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Connector cannot connect | Wrong URL, TLS, or proxy | `curl https://mcp.example.com/health`; URL must include `/mcp` (and `PATH_PREFIX` if set) |
| `401 Unauthorized` | Missing or wrong API key | Check Bearer token / `Authorization` header |
| `400` missing user context | No `X-Concrete-User-Id` and key is not user-bound | Add the header or use `MCP_API_KEYS` with a numeric user ID |
| Tools fail / not authenticated | CMS OAuth not completed for that user | Run `/oauth/start`, confirm `/oauth/status` |
| Duplicate / flaky auth in ChatGPT | Bearer env var **and** `Authorization` header both set | Use one auth method only |
| Path 404 | `PATH_PREFIX` mismatch | Use `https://cms.example.com/ccm-mcp/mcp` when `PATH_PREFIX=/ccm-mcp` |

## Security recommendations

- Prefer a **personal** `MCP_API_KEYS` entry for desktop clients
- Store secrets in env vars, not in committed config or screenshots
- Revoke with `/oauth/revoke` when finished on a shared machine
- Keep MCP and CMS behind HTTPS

## Related docs

- [Remote MCP Server Guide](remote-server.md) — deploy HTTP mode
- [Security Guide](security.md) — tokens, API keys, trust model
- [MCP Client Developer Guide](mcp-client-guide.md) — build a custom HTTP client
- [Main README](../README.md) — local stdio (Claude Desktop spawning the process)
