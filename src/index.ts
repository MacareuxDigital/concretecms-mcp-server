import * as client from 'openid-client'
// @ts-ignore
import { OpenAPIServer, AuthProvider } from "@ivotoby/openapi-mcp-server"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createServer } from 'http'
import { exec } from 'child_process'
import { AxiosError } from 'axios'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'

const canonical_url = process.env.CONCRETE_CANONICAL_URL;
const client_id = process.env.CONCRETE_API_CLIENT_ID;
const client_secret = process.env.CONCRETE_API_CLIENT_SECRET;
const scope = process.env.CONCRETE_API_SCOPE;

if (!canonical_url || !client_id || !client_secret || !scope) {
    throw new Error("Missing environment variables");
}

// トークンストレージのパス
const TOKEN_DIR = join(homedir(), '.concretecms-mcp');
const TOKEN_FILE = join(TOKEN_DIR, 'tokens.json');

interface StoredTokens {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    parameters: Record<string, string>;
}

// トークンをファイルから読み込む
function loadTokens(): StoredTokens | null {
    try {
        if (existsSync(TOKEN_FILE)) {
            const data = readFileSync(TOKEN_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[concretecms-mcp] Failed to load tokens:', error);
    }
    return null;
}

// トークンをファイルに保存する
function saveTokens(tokens: StoredTokens): void {
    try {
        if (!existsSync(TOKEN_DIR)) {
            mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
        }
        writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
        console.error('[concretecms-mcp] Tokens saved successfully');
    } catch (error) {
        console.error('[concretecms-mcp] Failed to save tokens:', error);
    }
}

let server: client.ServerMetadata = {
    issuer: canonical_url,
    authorization_endpoint: canonical_url + "/oauth/2.0/authorize",
    token_endpoint: canonical_url + "/oauth/2.0/token",
}
let config: client.Configuration = new client.Configuration(server, client_id, client_secret);

class RefreshTokenGrantProvider implements AuthProvider {
    set accessToken(value: string | undefined) {
        this._accessToken = value;
    }

    set refreshToken(value: string | undefined) {
        this._refreshToken = value;
    }

    set expiresAt(value: number | undefined) {
        this._expiresAt = value;
    }

    set parameters(value: Record<string, string> | undefined) {
        this._parameters = value;
    }

    private _accessToken: string | undefined;

    private _refreshToken: string | undefined;

    private _expiresAt: number | undefined;

    private _parameters: Record<string, string> | undefined;

    async getAuthHeaders(): Promise<Record<string, string>> {
        if (!this._accessToken) {
            throw new Error("Access token not available");
        }

        if (!this._refreshToken) {
            throw new Error("Refresh token not available");
        }

        // トークンが期限切れの場合はリフレッシュ
        if (this._expiresAt && Date.now() > this._expiresAt) {
            await this.refreshAccessToken();
        }

        return {
            Authorization: `Bearer ${this._accessToken}`,
        };
    }

    async handleAuthError(error: AxiosError): Promise<boolean> {
        if (error.response?.status === 401 || error.response?.status === 403) {
            try {
                await this.refreshAccessToken();
                return true;
            } catch (refreshError) {
                console.error('[concretecms-mcp] Failed to refresh token, re-authentication required');
                throw new Error("Failed to refresh access token");
            }
        }

        return false;
    }

    private async refreshAccessToken(): Promise<void> {
        if (this._refreshToken && this._parameters) {
            try {
                console.error('[concretecms-mcp] Refreshing access token...');
                let tokenEndpointResponse: client.TokenEndpointResponse = await client.refreshTokenGrant(
                    config,
                    this._refreshToken,
                    this._parameters
                )

                this._accessToken = tokenEndpointResponse.access_token;
                this._expiresAt = Date.now() + (tokenEndpointResponse.expires_in! * 1000);

                // リフレッシュトークンが新しく発行された場合は更新
                if (tokenEndpointResponse.refresh_token) {
                    this._refreshToken = tokenEndpointResponse.refresh_token;
                }

                // トークンを保存
                saveTokens({
                    access_token: this._accessToken,
                    refresh_token: this._refreshToken,
                    expires_at: this._expiresAt,
                    parameters: this._parameters
                });

                console.error('[concretecms-mcp] Access token refreshed successfully');
            } catch (error) {
                console.error('[concretecms-mcp] Token refresh failed:', error);
                throw error;
            }
        }
    }

    // 既存のトークンを読み込む
    loadStoredTokens(): boolean {
        const stored = loadTokens();
        if (stored) {
            this._accessToken = stored.access_token;
            this._refreshToken = stored.refresh_token;
            this._expiresAt = stored.expires_at;
            this._parameters = stored.parameters;
            console.error('[concretecms-mcp] Loaded stored tokens');
            return true;
        }
        return false;
    }
}

const authProvider = new RefreshTokenGrantProvider();

// OAuth認証フローを実行
async function performOAuthFlow(): Promise<void> {
    let redirect_uri: string = 'http://localhost:3000/callback';
    let code_verifier: string = client.randomPKCECodeVerifier();
    let code_challenge: string = await client.calculatePKCECodeChallenge(code_verifier);

    let parameters: Record<string, string> = {
        redirect_uri,
        scope: scope || "account:read",
        code_challenge,
        code_challenge_method: "S256",
    }

    let redirectTo: URL = client.buildAuthorizationUrl(config, parameters);

    return new Promise<void>((resolve, reject) => {
        const PORT = 3000;
        const httpServer = createServer(async (req, res) => {
            const url = new URL(req.url!, `http://localhost:${PORT}`);

            if (url.pathname === '/') {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Redirecting to Authorization...</title>
                    </head>
                    <body>
                        <h1>Redirecting to authorization page...</h1>
                        <p>If you are not redirected automatically, <a href="${redirectTo.toString()}">click here</a>.</p>
                        <script>
                            window.location = "${redirectTo.toString()}";
                        </script>
                    </body>
                    </html>
                `);
            } else if (url.pathname === '/callback') {
                try {
                    const getCurrentUrl = () => new URL(req.url!, `http://localhost:${PORT}`);
                    console.error('[concretecms-mcp] Received callback with code:', url.searchParams.get('code'));
                    let tokens: client.TokenEndpointResponse = await client.authorizationCodeGrant(
                        config,
                        getCurrentUrl(),
                        {
                            pkceCodeVerifier: code_verifier,
                        }
                    )

                    console.error('[concretecms-mcp] Token Endpoint Response', tokens);

                    // authProviderにトークンを設定
                    authProvider.accessToken = tokens.access_token;
                    authProvider.refreshToken = tokens.refresh_token;
                    const expiresAt = Date.now() + (tokens.expires_in! * 1000);
                    authProvider.expiresAt = expiresAt;
                    authProvider.parameters = parameters;

                    // トークンを保存
                    saveTokens({
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token!,
                        expires_at: expiresAt,
                        parameters: parameters
                    });

                    res.writeHead(200, {'Content-Type': 'text/html'});
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Authorization Successful</title>
                        </head>
                        <body>
                            <h1>Authorization Successful!</h1>
                            <p>You can close this window and return to the application.</p>
                        </body>
                        </html>
                    `);

                    httpServer.close();
                    resolve();
                } catch (error) {
                    console.error('[concretecms-mcp] Token exchange failed:', error);

                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Authorization Failed</title>
                        </head>
                        <body>
                            <h1>Authorization Failed</h1>
                            <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
                        </body>
                        </html>
                    `);

                    httpServer.close();
                    reject(error);
                }
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        httpServer.listen(PORT, () => {
            console.error(`[concretecms-mcp] Local server started on http://localhost:${PORT}`);
            console.error(`[concretecms-mcp] Opening browser...`);

            const platform = process.platform;
            let command: string;

            if (platform === 'darwin') {
                command = `open "http://localhost:${PORT}"`;
            } else if (platform === 'win32') {
                command = `start "" "http://localhost:${PORT}"`;
            } else {
                command = `xdg-open "http://localhost:${PORT}"`;
            }

            exec(command, (error) => {
                if (error) {
                    console.error('[concretecms-mcp] Failed to open browser automatically.');
                    console.error(`[concretecms-mcp] Please open this URL manually: http://localhost:${PORT}`);
                }
            });
        });
    });
}

async function main(): Promise<void> {
    // 既存のトークンを読み込む
    const hasStoredTokens = authProvider.loadStoredTokens();

    if (hasStoredTokens) {
        console.error('[concretecms-mcp] Using stored tokens');

        // トークンのリフレッシュを試みる
        try {
            await authProvider.getAuthHeaders(); // これにより必要に応じてリフレッシュされる
            console.error('[concretecms-mcp] Tokens validated successfully');
        } catch (error) {
            console.error('[concretecms-mcp] Stored tokens invalid, starting OAuth flow...');
            await performOAuthFlow();
        }
    } else {
        console.error('[concretecms-mcp] No stored tokens found, starting OAuth flow...');
        await performOAuthFlow();
    }

    console.error('[concretecms-mcp] Starting MCP server...');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const openApiSpecFile = join(__dirname, "../openapi.yml");
    const openApiServerConfig = {
        name: "Concrete CMS",
        version: "1.0.0",
        apiBaseUrl: canonical_url,
        openApiSpec: openApiSpecFile,
        specInputMethod: "file" as const,
        transportType: "stdio" as const,
        toolMode: "all" as const,
        authProvider: authProvider
    }
    const openApiServer = new OpenAPIServer(openApiServerConfig);
    const transport = new StdioServerTransport();
    await openApiServer.start(transport);
}

main().catch((error) => {
    console.error("[concretecms-mcp] Error in MCP server:", error);
    process.exit(1);
})
