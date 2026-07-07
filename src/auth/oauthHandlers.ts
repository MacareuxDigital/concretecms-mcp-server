import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  healthPath,
  oauthCallbackPath,
  oauthRedirectUri,
  oauthRevokePath,
  oauthStartPath,
  oauthStatusPath,
  publicBaseUrl,
  scope,
  transportType,
} from '../env.js'
import { clearTokens } from '../tokenStore.js'
import { MultiUserAuthProvider } from './MultiUserAuthProvider.js'
import { acquireOAuthStartLock, releaseOAuthStartLock } from './authCoordinator.js'
import { consumeOAuthSession, createOAuthSession } from './oauthSession.js'
import { exchangeAuthorizationCode, saveTokensForUser } from './oauthTokens.js'
import { parseOAuthUserId, validateOAuthApiKey } from '../server/authMiddleware.js'
import { sendJson, blockFurtherResponseWrites } from '../server/httpResponse.js'
import { redactError } from '../utils/redact.js'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 10
const rateLimitBuckets = new Map<string, number[]>()

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
  blockFurtherResponseWrites(res)
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitBuckets.get(key) ?? []
  const recent = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitBuckets.set(key, recent)
    return true
  }

  recent.push(now)
  rateLimitBuckets.set(key, recent)
  return false
}

function parsePositiveUserId(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

async function handleOAuthStart(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  if (res.writableEnded) {
    return
  }

  if (transportType === 'http' && !validateOAuthApiKey(req)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }

  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { error: 'Origin not allowed' })
    return
  }

  const clientIp = getClientIp(req)
  if (isRateLimited(`oauth-start:${clientIp}`)) {
    sendJson(res, 429, { error: 'Too many requests' })
    return
  }

  const intendedUserId = parsePositiveUserId(url.searchParams.get('user_id'))
  const lockUserId = intendedUserId !== undefined ? String(intendedUserId) : 'pending-oauth'

  if (!acquireOAuthStartLock(lockUserId)) {
    sendJson(res, 409, { error: 'OAuth already in progress for this user' })
    return
  }

  try {
    const { authorizationUrl } = await createOAuthSession(
      oauthRedirectUri,
      scope || 'account:read',
      intendedUserId,
      lockUserId
    )

    res.writeHead(302, { Location: authorizationUrl.toString() })
    res.end()
    blockFurtherResponseWrites(res)
  } catch (error) {
    releaseOAuthStartLock(lockUserId)
    console.error(`[concretecms-mcp] OAuth start failed: ${redactError(error)}`)
    sendJson(res, 500, { error: 'Failed to start OAuth flow' })
  }
}

async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  authProvider: MultiUserAuthProvider
): Promise<void> {
  if (res.writableEnded) {
    return
  }

  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { error: 'Origin not allowed' })
    return
  }

  const clientIp = getClientIp(req)
  if (isRateLimited(`oauth-callback:${clientIp}`)) {
    sendJson(res, 429, { error: 'Too many requests' })
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
    console.error('[concretecms-mcp] Processing OAuth callback')
    const tokens = await exchangeAuthorizationCode(callbackUrl, session.codeVerifier, state)
    const { userId, stored } = await saveTokensForUser(
      tokens,
      session.parameters,
      session.intendedUserId
    )

    authProvider.getSessionForUser(userId).applyTokens(stored)

    sendHtml(
      res,
      200,
      'Authorization Successful',
      `<h1>Authorization Successful!</h1><p>User ${userId} is now authorized. You can close this window and return to the application.</p>`
    )
  } catch (error) {
    console.error(`[concretecms-mcp] Token exchange failed: ${redactError(error)}`)
    sendHtml(
      res,
      400,
      'Authorization Failed',
      '<h1>Authorization Failed</h1><p>Authorization could not be completed. Please try again.</p>'
    )
  } finally {
    releaseOAuthStartLock(session.lockUserId)
  }
}

function handleOAuthStatus(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authProvider: MultiUserAuthProvider
): void {
  if (res.writableEnded) {
    return
  }

  if (transportType === 'http' && !validateOAuthApiKey(req)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }

  const userId = parseOAuthUserId(req, url) ?? url.searchParams.get('user_id')
  if (!userId) {
    sendJson(res, 400, { error: 'Missing or invalid user_id' })
    return
  }

  const userKey = String(userId)
  const authenticated = authProvider.isAuthenticated(userKey)

  sendJson(res, 200, {
    userId: Number.parseInt(userKey, 10),
    authenticated,
    expiresAt: authenticated ? authProvider.getExpiresAt(userKey) : undefined,
  })
}

function handleOAuthRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authProvider: MultiUserAuthProvider
): void {
  if (res.writableEnded) {
    return
  }

  if (transportType === 'http' && !validateOAuthApiKey(req)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }

  const userId = parseOAuthUserId(req, url) ?? url.searchParams.get('user_id')
  if (!userId) {
    sendJson(res, 400, { error: 'Missing or invalid user_id' })
    return
  }

  const userKey = String(userId)
  clearTokens(userKey)
  authProvider.clearUser(userKey)

  sendJson(res, 200, { revoked: true, userId: Number.parseInt(userKey, 10) })
}

function handleHealth(res: ServerResponse): void {
  if (res.writableEnded) {
    return
  }

  sendJson(res, 200, { status: 'healthy' })
}

export function attachOAuthHandlers(server: Server, authProvider: MultiUserAuthProvider): void {
  server.on('request', (req, res) => {
    if (!req.url || res.writableEnded) {
      return
    }

    const url = new URL(req.url, publicBaseUrl)

    if (url.pathname === oauthStartPath && req.method === 'GET') {
      void handleOAuthStart(req, res, url)
      return
    }

    if (url.pathname === oauthCallbackPath && req.method === 'GET') {
      void handleOAuthCallback(req, res, authProvider)
      return
    }

    if (url.pathname === oauthStatusPath && req.method === 'GET') {
      handleOAuthStatus(req, res, url, authProvider)
      return
    }

    if (url.pathname === oauthRevokePath && req.method === 'POST') {
      handleOAuthRevoke(req, res, url, authProvider)
      return
    }

    // /health is handled by the MCP transport library when PATH_PREFIX is unset.
    // Custom health paths (with PATH_PREFIX) are handled here.
    if (url.pathname === healthPath && req.method === 'GET' && healthPath !== '/health') {
      handleHealth(res)
    }
  })
}
