import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  healthPath,
  oauthCallbackPath,
  oauthRedirectUri,
  oauthStartPath,
  oauthStatusPath,
  publicBaseUrl,
  scope,
} from '../env.js'
import { RefreshTokenGrantProvider } from './RefreshTokenGrantProvider.js'
import { consumeOAuthSession, createOAuthSession } from './oauthSession.js'
import { applyTokensToProvider, exchangeAuthorizationCode } from './oauthTokens.js'

function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) {
    return true
  }

  try {
    const originUrl = new URL(origin)
    const publicUrl = new URL(publicBaseUrl)
    return originUrl.origin === publicUrl.origin
  } catch {
    return false
  }
}

function sendHtml(res: ServerResponse, statusCode: number, title: string, body: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/html' })
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
    </head>
    <body>
      ${body}
    </body>
    </html>
  `)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function handleOAuthStart(
  req: IncomingMessage,
  res: ServerResponse,
  authProvider: RefreshTokenGrantProvider
): Promise<void> {
  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { error: 'Origin not allowed' })
    return
  }

  const { authorizationUrl } = await createOAuthSession(oauthRedirectUri, scope || 'account:read')

  res.writeHead(302, { Location: authorizationUrl.toString() })
  res.end()
}

async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  authProvider: RefreshTokenGrantProvider
): Promise<void> {
  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { error: 'Origin not allowed' })
    return
  }

  const callbackUrl = new URL(req.url!, publicBaseUrl)
  const state = callbackUrl.searchParams.get('state')
  const session = consumeOAuthSession(state)

  if (!session) {
    sendHtml(
      res,
      400,
      'Authorization Failed',
      '<h1>Authorization Failed</h1><p>Invalid or expired OAuth session. Please try again.</p>'
    )
    return
  }

  try {
    console.error('[concretecms-mcp] Received callback with code:', callbackUrl.searchParams.get('code'))
    const tokens = await exchangeAuthorizationCode(callbackUrl, session.codeVerifier, state)
    applyTokensToProvider(authProvider, tokens, session.parameters)

    sendHtml(
      res,
      200,
      'Authorization Successful',
      '<h1>Authorization Successful!</h1><p>You can close this window and return to the application.</p>'
    )
  } catch (error) {
    console.error('[concretecms-mcp] Token exchange failed:', error)
    sendHtml(
      res,
      400,
      'Authorization Failed',
      `<h1>Authorization Failed</h1><p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>`
    )
  }
}

function handleOAuthStatus(res: ServerResponse, authProvider: RefreshTokenGrantProvider): void {
  sendJson(res, 200, {
    authenticated: authProvider.isAuthenticated(),
    expiresAt: authProvider.getExpiresAt(),
  })
}

function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, { status: 'healthy' })
}

export function attachOAuthHandlers(server: Server, authProvider: RefreshTokenGrantProvider): void {
  server.on('request', (req, res) => {
    if (!req.url || req.method !== 'GET') {
      return
    }

    const url = new URL(req.url, publicBaseUrl)

    if (url.pathname === oauthStartPath) {
      void handleOAuthStart(req, res, authProvider)
      return
    }

    if (url.pathname === oauthCallbackPath) {
      void handleOAuthCallback(req, res, authProvider)
      return
    }

    if (url.pathname === oauthStatusPath) {
      handleOAuthStatus(res, authProvider)
      return
    }

    if (url.pathname === healthPath) {
      handleHealth(res)
    }
  })
}
