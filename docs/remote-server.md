# Remote MCP Server Guide

Use remote mode when a remote MCP client needs to connect over HTTP instead of spawning a local stdio process. This is useful for hosted AI agents, CMS dashboards, or personal clients using the `mcp-remote` bridge.

The server exposes a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) MCP endpoint and persistent OAuth routes.

For local stdio mode (Claude Desktop spawning the process), see the [main README](../README.md).

## Client modes

| Mode | Client | Auth headers |
|------|--------|--------------|
| **A. Local stdio** | Claude Desktop spawns `node dist/index.js` | None (single `local` user) |
| **B. Personal remote** | Claude Desktop → `mcp-remote` → remote `/mcp` | `Authorization` + `X-Concrete-User-Id` (or user-bound API key) |
| **C. Dashboard** | CMS backend → remote `/mcp` | `Authorization` + `X-Concrete-User-Id` per session |

See the [Security Guide](security.md) for the full trust model.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRANSPORT_TYPE` | No | `stdio` | Set to `http` for remote mode |
| `PUBLIC_BASE_URL` | Yes (http mode) | — | Public URL of this server, e.g. `https://mcp.example.com` |
| `TOKEN_ENCRYPTION_KEY` | Yes (http mode) | — | AES-256-GCM encryption key for token files |
| `MCP_API_KEY` | Yes (http mode)* | — | Bearer token for MCP clients |
| `MCP_API_KEYS` | Alternative | — | JSON map of API keys to CMS user IDs (`null` = dynamic) |
| `PATH_PREFIX` | No | _(empty)_ | Path prefix for all routes, e.g. `/ccm-mcp` |
| `HTTP_HOST` | No | `0.0.0.0` | Bind address |
| `HTTP_PORT` | No | `3000` | Listen port |
| `TOKEN_DIR` | No | `~/.concretecms-mcp/tokens` | Per-user encrypted token directory |
| `MCP_ENDPOINT_PATH` | No | `{PATH_PREFIX}/mcp` | Streamable HTTP MCP endpoint |
| `OAUTH_START_PATH` | No | `{PATH_PREFIX}/oauth/start` | OAuth initiation path |
| `OAUTH_CALLBACK_PATH` | No | `{PATH_PREFIX}/oauth/callback` | OAuth redirect path |
| `OAUTH_STATUS_PATH` | No | `{PATH_PREFIX}/oauth/status` | OAuth status path |
| `OAUTH_REVOKE_PATH` | No | `{PATH_PREFIX}/oauth/revoke` | Per-user token revocation |
| `HEALTH_PATH` | No | `{PATH_PREFIX}/health` | Health check path |

\* Either `MCP_API_KEY` or `MCP_API_KEYS` is required in http mode.

All `CONCRETE_*` variables from the [main README](../README.md) are still required. `CONCRETE_API_SCOPE` must include `account:read` so the server can resolve CMS user IDs after OAuth.

### Generate secrets

```bash
# Encryption key (TOKEN_ENCRYPTION_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# MCP client API key (MCP_API_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store secrets in systemd `Environment=` directives or a root-only `0400` env file — not in a world-readable `.env` on production servers.

## Concrete CMS OAuth setup

Register this redirect URI in your Concrete CMS API integration:

```
https://mcp.example.com/oauth/callback
```

Use the same value as `${PUBLIC_BASE_URL}${OAUTH_CALLBACK_PATH}`.

## Per-user authorization (http mode)

Each CMS user must authorize separately. API calls use the token for the user specified by `X-Concrete-User-Id`.

### Authorize a user

```bash
# Obtain redirect URL (open Location in browser)
curl -sI -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/start?user_id=42"
```

Sign in to CMS as that user and approve scopes. Tokens are saved on the server as `{userId}.tokens.json` and `{userId}.client.json` under `TOKEN_DIR`.

If another OAuth flow is already running for that user, `/oauth/start` returns `409`.

### Check status

```bash
curl -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/status?user_id=42"
```

```json
{ "userId": 42, "authenticated": true, "expiresAt": 1710000000000 }
```

### Revoke a user

```bash
curl -X POST -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/revoke?user_id=42"
```

## Hosting options

### Dedicated subdomain (default)

Run the MCP server on its own hostname, for example `mcp.example.com`, pointing at your Concrete CMS site `cms.example.com`. Leave `PATH_PREFIX` unset.

- MCP endpoint: `https://mcp.example.com/mcp`
- OAuth start: `https://mcp.example.com/oauth/start`
- OAuth callback: `https://mcp.example.com/oauth/callback`

### Same domain with a path prefix

You can also run the MCP server on the same domain as Concrete CMS by setting a path prefix. This avoids conflicts with CMS routes such as `/oauth/2.0/authorize`.

```bash
TRANSPORT_TYPE=http
PUBLIC_BASE_URL=https://cms.example.com
PATH_PREFIX=/ccm-mcp
CONCRETE_CANONICAL_URL=https://cms.example.com
```

With `PATH_PREFIX=/ccm-mcp`, the routes become:

- MCP endpoint: `https://cms.example.com/ccm-mcp/mcp`
- OAuth start: `https://cms.example.com/ccm-mcp/oauth/start`
- OAuth callback: `https://cms.example.com/ccm-mcp/oauth/callback`

Register the callback URL in your Concrete CMS API integration:

```
https://cms.example.com/ccm-mcp/oauth/callback
```

Individual path env vars (`MCP_ENDPOINT_PATH`, `OAUTH_START_PATH`, etc.) can override the defaults if needed.

When sharing a domain with Concrete CMS, do not proxy the entire `/oauth/` prefix to the MCP server, because CMS uses `/oauth/2.0/*` for its own OAuth endpoints.

## Deploy on Linux with systemd

For production, running the MCP server as a **systemd service** is a simple and reliable approach. The server listens on port 3000 locally; place a reverse proxy in front for public access.

### 1. Install Node.js 20+

Install Node.js 20 or later using your platform's recommended method. See the [Node.js download page](https://nodejs.org/en/download) for official packages and instructions.

Verify the installation:

```bash
node -v
npm -v
```

### 2. Clone and build

Choose an installation directory on your server, for example `/opt/concretecms-mcp`:

```bash
sudo mkdir -p /opt/concretecms-mcp
sudo chown mcp:mcp /opt/concretecms-mcp
cd /opt/concretecms-mcp
git clone https://github.com/MacareuxDigital/concretecms-mcp-server.git .
npm ci && npm run build
```

### 3. Configure environment

Create a secrets file readable only by the service user:

```bash
sudo install -o mcp -g mcp -m 0400 /dev/null /etc/concretecms-mcp.env
sudo vi /etc/concretecms-mcp.env
```

Example:

```bash
PUBLIC_BASE_URL=https://mcp.example.com
CONCRETE_CANONICAL_URL=https://cms.example.com
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET
CONCRETE_API_SCOPE=account:read system:info:read
HTTP_PORT=3000
TOKEN_ENCRYPTION_KEY=your-base64-key
MCP_API_KEY=your-mcp-api-key
TOKEN_DIR=/var/lib/concretecms-mcp/tokens
```

```bash
sudo mkdir -p /var/lib/concretecms-mcp/tokens
sudo chown mcp:mcp /var/lib/concretecms-mcp/tokens
sudo chmod 700 /var/lib/concretecms-mcp/tokens
```

### 4. Create a systemd service

```bash
sudo vi /etc/systemd/system/concretecms-mcp.service
```

```ini
[Unit]
Description=Concrete CMS MCP Server
After=network.target

[Service]
Type=simple
User=mcp
Group=mcp
WorkingDirectory=/opt/concretecms-mcp
EnvironmentFile=/etc/concretecms-mcp.env
Environment=TRANSPORT_TYPE=http
Environment=HTTP_HOST=0.0.0.0
Environment=HTTP_PORT=3000
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Replace paths and `ExecStart` with values that match your server. Confirm the Node.js path with `which node`.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable concretecms-mcp
sudo systemctl start concretecms-mcp
sudo systemctl status concretecms-mcp
```

Useful commands:

```bash
sudo systemctl restart concretecms-mcp
sudo journalctl -u concretecms-mcp -f
sudo systemctl reset-failed concretecms-mcp
```

After deploying code changes:

```bash
cd /opt/concretecms-mcp
git pull
npm run build
sudo systemctl restart concretecms-mcp
```

### 5. Reverse proxy

Expose the service through your reverse proxy. The examples below use nginx, but the same routes can be configured on Apache, Caddy, or another proxy.

Consider `limit_req` on OAuth routes as defense-in-depth:

```nginx
limit_req_zone $binary_remote_addr zone=mcp_oauth:10m rate=10r/m;
```

#### Dedicated subdomain

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}

location = /oauth/start {
    limit_req zone=mcp_oauth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/callback {
    limit_req zone=mcp_oauth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/status {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location = /oauth/revoke {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location = /health {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

#### Same domain with `PATH_PREFIX=/ccm-mcp`

```nginx
location /ccm-mcp/mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

location /ccm-mcp/oauth/ {
    proxy_pass http://127.0.0.1:3000;
}

location /ccm-mcp/health {
    proxy_pass http://127.0.0.1:3000;
}
```

Reload your proxy after changing the configuration.

## Connect a remote MCP client

### Mode C — CMS dashboard backend

Send on every `/mcp` request:

```
Authorization: Bearer <MCP_API_KEY>
X-Concrete-User-Id: <cms_user_id>
```

Poll `/oauth/status?user_id=<id>` before enabling AI for a user. Trigger `/oauth/start?user_id=<id>` when not authenticated.

### Mode B — Claude Desktop via mcp-remote

Claude Desktop connects through a local stdio bridge. Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "concretecms-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.example.com/mcp",
        "--transport",
        "http-only",
        "--header",
        "Authorization:${MCP_AUTH}",
        "--header",
        "X-Concrete-User-Id:${CONCRETE_USER_ID}"
      ],
      "env": {
        "MCP_AUTH": "Bearer your-mcp-api-key",
        "CONCRETE_USER_ID": "42"
      }
    }
  }
}
```

Authorize first:

```bash
curl -sI -H "Authorization: Bearer your-mcp-api-key" \
  "https://mcp.example.com/oauth/start"
```

Alternatively, bind a personal API key to a user with `MCP_API_KEYS` so only `Authorization` is needed.

### Example MCP request

```bash
curl -X POST https://mcp.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer your-mcp-api-key" \
  -H "X-Concrete-User-Id: 42" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

Requests without `Authorization` return `401`. Requests without user context return `400`.

## Docker deployment (alternative)

If you prefer containers over systemd:

```bash
cp .env.example .env
# edit .env — set TOKEN_ENCRYPTION_KEY and MCP_API_KEY
docker compose up -d --build
```

`TRANSPORT_TYPE=http` is set in `docker-compose.yml`. Tokens are persisted in the `mcp-tokens` Docker volume.

## Security

See the **[Security Guide](security.md)** for encryption, file permissions, trust model, and token revocation.
