import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  mcpApiKeys,
  mcpEndpointPath,
  oauthRevokePath,
  oauthStartPath,
  oauthStatusPath,
  publicBaseUrl,
  transportType,
} from '../env.js'
import { setRequestUserId } from './userContext.js'
import { sendJson } from './httpResponse.js'

const USER_ID_HEADER = 'x-concrete-user-id'
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 10

const rateLimitBuckets = new Map<string, number[]>()

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  return header.slice('Bearer '.length).trim()
}

function matchesApiKey(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

function resolveApiKey(
  token: string
): { boundUserId: number | null } | null {
  for (const entry of mcpApiKeys) {
    if (matchesApiKey(token, entry.key)) {
      return { boundUserId: entry.boundUserId }
    }
  }
  return null
}

function parsePositiveUserId(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
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

function resolveUserId(
  req: IncomingMessage,
  url: URL,
  boundUserId: number | null
): number | null {
  if (boundUserId !== null) {
    return boundUserId
  }

  const headerValue = req.headers[USER_ID_HEADER]
  const headerUserId = parsePositiveUserId(
    Array.isArray(headerValue) ? headerValue[0] : headerValue
  )
  if (headerUserId) {
    return headerUserId
  }

  return parsePositiveUserId(url.searchParams.get('user_id'))
}

function requiresApiKey(pathname: string): boolean {
  return (
    pathname === mcpEndpointPath ||
    pathname === oauthStartPath ||
    pathname === oauthStatusPath ||
    pathname === oauthRevokePath
  )
}

function handleProtectedRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): boolean {
  const bearer = extractBearerToken(req)
  if (!bearer) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return true
  }

  const keyMatch = resolveApiKey(bearer)
  if (!keyMatch) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return true
  }

  if (url.pathname === oauthStatusPath) {
    const clientIp = getClientIp(req)
    if (isRateLimited(`oauth-status:${clientIp}`)) {
      sendJson(res, 429, { error: 'Too many requests' })
      return true
    }
  }

  const userId = resolveUserId(req, url, keyMatch.boundUserId)
  if (url.pathname === mcpEndpointPath || url.pathname === oauthRevokePath) {
    if (!userId) {
      sendJson(res, 400, { error: 'Missing or invalid user context' })
      return true
    }
    setRequestUserId(String(userId))
  } else if (userId) {
    setRequestUserId(String(userId))
  }

  return false
}

export function attachAuthMiddleware(server: Server): void {
  if (transportType !== 'http') {
    return
  }

  server.prependListener('request', (req, res) => {
    if (!req.url) {
      return
    }

    const url = new URL(req.url, publicBaseUrl)
    if (!requiresApiKey(url.pathname)) {
      return
    }

    handleProtectedRoute(req, res, url)
  })
}

export function validateOAuthApiKey(req: IncomingMessage): boolean {
  const bearer = extractBearerToken(req)
  if (!bearer) {
    return false
  }
  return resolveApiKey(bearer) !== null
}

export function parseOAuthUserId(req: IncomingMessage, url: URL): number | null {
  const bearer = extractBearerToken(req)
  if (!bearer) {
    return null
  }

  const keyMatch = resolveApiKey(bearer)
  if (!keyMatch) {
    return null
  }

  return resolveUserId(req, url, keyMatch.boundUserId)
}
