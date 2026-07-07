# Remote MCP Server Guide

Use remote mode when an AI agent in the Concrete CMS dashboard (or another remote client) needs to connect over HTTP instead of spawning a local stdio process.

The server exposes a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) MCP endpoint and persistent OAuth routes.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRANSPORT_TYPE` | No | `stdio` | Set to `http` for remote mode |
| `PUBLIC_BASE_URL` | Yes (http mode) | — | Public URL of this server, e.g. `https://mcp.your-concrete.example` |
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
https://mcp.your-concrete.example/oauth/callback
```

Use the same value as `${PUBLIC_BASE_URL}${OAUTH_CALLBACK_PATH}`.

## Same domain (no subdomain)

You can run the MCP server on the same domain as Concrete CMS by setting a path prefix. This avoids conflicts with CMS routes such as `/oauth/2.0/authorize`.

```bash
TRANSPORT_TYPE=http
PUBLIC_BASE_URL=https://your-concrete.example
PATH_PREFIX=/ccm-mcp
CONCRETE_CANONICAL_URL=https://your-concrete.example
```

With `PATH_PREFIX=/ccm-mcp`, the routes become:

- MCP endpoint: `https://your-concrete.example/ccm-mcp/mcp`
- OAuth start: `https://your-concrete.example/ccm-mcp/oauth/start`
- OAuth callback: `https://your-concrete.example/ccm-mcp/oauth/callback`

Register the callback URL in your Concrete CMS API integration:

```
https://your-concrete.example/ccm-mcp/oauth/callback
```

Individual path env vars (`MCP_ENDPOINT_PATH`, `OAUTH_START_PATH`, etc.) can override the defaults if needed.

## Deploy on Linux with systemd (recommended)

For production on a Linux server (e.g. Amazon Linux, Ubuntu), running the MCP server as a **systemd service** is the simplest approach. The server listens on port 3000 locally; nginx handles HTTPS in front.

### 1. Install Node.js 20+

On Amazon Linux 2023:

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node -v
```

### 2. Clone and build

```bash
sudo mkdir -p /var/www/vhosts/mcp.your-concrete.example
sudo chown $USER /var/www/vhosts/mcp.your-concrete.example
cd /var/www/vhosts/mcp.your-concrete.example
git clone https://github.com/MacareuxDigital/concretecms-mcp-server.git .
npm ci && npm run build
```

### 3. Configure environment

```bash
cp .env.example .env
vi .env
```

Example for a dedicated subdomain:

```bash
PUBLIC_BASE_URL=https://mcp.your-concrete.example
CONCRETE_CANONICAL_URL=https://your-concrete.example
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET
CONCRETE_API_SCOPE="account:read system:info:read"
HTTP_PORT=3000
```

Notes:

- Use a **single-level subdomain** (e.g. `mcp.example.c5j.me`) if your TLS certificate is a wildcard for `*.c5j.me`. Nested subdomains like `mcp.site.example.com` are not covered by `*.example.com`.
- Quote values that contain spaces or `#` (systemd treats `#` as a comment in env files).
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
User=www-user
WorkingDirectory=/var/www/vhosts/mcp.your-concrete.example
EnvironmentFile=/var/www/vhosts/mcp.your-concrete.example/.env
Environment=TRANSPORT_TYPE=http
Environment=HTTP_HOST=0.0.0.0
Environment=HTTP_PORT=3000
Environment=TOKEN_FILE=/var/www/vhosts/mcp.your-concrete.example/.tokens.json
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `www-user` and paths with your deployment user and directory. Confirm the Node.js path with `which node`.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable concretecms-mcp
sudo systemctl start concretecms-mcp
sudo systemctl status concretecms-mcp
```

Useful commands:

```bash
sudo systemctl restart concretecms-mcp          # after git pull && npm run build
sudo journalctl -u concretecms-mcp -f          # follow logs
sudo systemctl reset-failed concretecms-mcp    # if the service hit restart limits
```

After deploying code changes:

```bash
cd /var/www/vhosts/mcp.your-concrete.example
git pull
npm run build
sudo systemctl restart concretecms-mcp
```

### 5. Reverse proxy (nginx)

Add a vhost for your MCP subdomain. Copy `ssl_certificate` paths from an existing site on the same server.

```nginx
server {
    listen 443 ssl;
    server_name mcp.your-concrete.example;

    ssl_certificate     /path/to/your/cert.crt;
    ssl_certificate_key /path/to/your/cert.key;

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
}

server {
    listen 80;
    server_name mcp.your-concrete.example;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

See [Reverse proxy examples](#reverse-proxy-examples) below for path-prefix setups.

### 6. Authorize

1. Open `https://mcp.your-concrete.example/oauth/start` in a browser.
2. Sign in to Concrete CMS and approve the requested scopes.
3. Check status at `GET /oauth/status`:

```json
{ "authenticated": true, "expiresAt": 1710000000000 }
```

## Connect a remote MCP client

Remote clients connect to the Streamable HTTP endpoint:

```
POST https://mcp.your-concrete.example/mcp
```

Example initialize request:

```bash
curl -X POST https://mcp.your-concrete.example/mcp \
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

## Reverse proxy examples

When using `PATH_PREFIX=/ccm-mcp`:

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

Without a path prefix:

```nginx
location /mcp {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_buffering off;
}

location = /oauth/start {
  proxy_pass http://127.0.0.1:3000;
}

location = /oauth/callback {
  proxy_pass http://127.0.0.1:3000;
}

location = /oauth/status {
  proxy_pass http://127.0.0.1:3000;
}

location = /health {
  proxy_pass http://127.0.0.1:3000;
}
```

Do not proxy the entire `/oauth/` prefix to the MCP server when sharing a domain with Concrete CMS, because CMS uses `/oauth/2.0/*` for its own OAuth endpoints.
