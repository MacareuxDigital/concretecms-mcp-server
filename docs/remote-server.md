# Remote MCP Server Guide

Use remote mode when a remote MCP client needs to connect over HTTP instead of spawning a local stdio process. This is useful for hosted AI agents, web dashboards, or any client that cannot run the server as a local process.

The server exposes a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) MCP endpoint and persistent OAuth routes.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRANSPORT_TYPE` | No | `stdio` | Set to `http` for remote mode |
| `PUBLIC_BASE_URL` | Yes (http mode) | — | Public URL of this server, e.g. `https://mcp.example.com` |
| `PATH_PREFIX` | No | _(empty)_ | Path prefix for all routes, e.g. `/ccm-mcp` |
| `HTTP_HOST` | No | `0.0.0.0` | Bind address |
| `HTTP_PORT` | No | `3000` | Listen port |
| `MCP_ENDPOINT_PATH` | No | `{PATH_PREFIX}/mcp` | Streamable HTTP MCP endpoint |
| `OAUTH_START_PATH` | No | `{PATH_PREFIX}/oauth/start` | OAuth initiation path |
| `OAUTH_CALLBACK_PATH` | No | `{PATH_PREFIX}/oauth/callback` | OAuth redirect path |
| `OAUTH_STATUS_PATH` | No | `{PATH_PREFIX}/oauth/status` | OAuth status path |
| `HEALTH_PATH` | No | `{PATH_PREFIX}/health` | Health check path |
| `TOKEN_FILE` | No | `.tokens.json` | Token storage path |

All `CONCRETE_*` variables from the [main README](../README.md) are still required.

## Concrete CMS OAuth setup

Register this redirect URI in your Concrete CMS API integration:

```
https://mcp.example.com/oauth/callback
```

Use the same value as `${PUBLIC_BASE_URL}${OAUTH_CALLBACK_PATH}`.

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
sudo chown $USER /opt/concretecms-mcp
cd /opt/concretecms-mcp
git clone https://github.com/MacareuxDigital/concretecms-mcp-server.git .
npm ci && npm run build
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` for your site. Example for a dedicated subdomain:

```bash
PUBLIC_BASE_URL=https://mcp.example.com
CONCRETE_CANONICAL_URL=https://cms.example.com
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET
CONCRETE_API_SCOPE="account:read system:info:read"
HTTP_PORT=3000
```

Notes:

- Quote values that contain spaces or `#` when using a systemd `EnvironmentFile`.
- Omit `PATH_PREFIX` when using a dedicated subdomain.

### 4. Create a systemd service

Use the **actual app directory** for all paths (the directory that contains `dist/` and `.env`):

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
WorkingDirectory=/opt/concretecms-mcp
EnvironmentFile=/opt/concretecms-mcp/.env
Environment=TRANSPORT_TYPE=http
Environment=HTTP_HOST=0.0.0.0
Environment=HTTP_PORT=3000
Environment=TOKEN_FILE=/opt/concretecms-mcp/.tokens.json
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `User`, paths, and `ExecStart` with values that match your server. Confirm the Node.js path with `which node`.

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

#### Dedicated subdomain

Add these `location` blocks to the vhost for your MCP hostname:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}

location = /oauth/start {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/callback {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/status {
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

### 6. Authorize

1. Open your OAuth start URL in a browser, for example `https://mcp.example.com/oauth/start`.
2. Sign in to Concrete CMS and approve the requested scopes.
3. Check status at `GET /oauth/status`:

```json
{ "authenticated": true, "expiresAt": 1710000000000 }
```

## Connect a remote MCP client

Remote clients connect to the Streamable HTTP endpoint:

```
POST https://mcp.example.com/mcp
```

Example initialize request:

```bash
curl -X POST https://mcp.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

## Docker deployment (alternative)

If you prefer containers over systemd:

```bash
cp .env.example .env
# edit .env
docker compose up -d --build
```

`TRANSPORT_TYPE=http` is set in `docker-compose.yml`. Tokens are persisted in the `mcp-tokens` Docker volume.
