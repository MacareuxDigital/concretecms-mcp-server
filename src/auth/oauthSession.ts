import * as client from 'openid-client'
import { config } from './oidc.js'

export interface OAuthSession {
  codeVerifier: string
  parameters: Record<string, string>
  createdAt: number
  intendedUserId?: number
  lockUserId: string
}

const SESSION_TTL_MS = 10 * 60 * 1000
const sessions = new Map<string, OAuthSession>()

function cleanupExpiredSessions(): void {
  const now = Date.now()

  for (const [state, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(state)
    }
  }
}

export async function createOAuthSession(
  redirectUri: string,
  requestedScope: string,
  intendedUserId?: number,
  lockUserId = intendedUserId !== undefined ? String(intendedUserId) : 'pending-oauth'
): Promise<{ state: string; authorizationUrl: URL; parameters: Record<string, string> }> {
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()

  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: requestedScope,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  }

  sessions.set(state, {
    codeVerifier,
    parameters,
    createdAt: Date.now(),
    intendedUserId,
    lockUserId,
  })

  cleanupExpiredSessions()

  return {
    state,
    parameters,
    authorizationUrl: client.buildAuthorizationUrl(config, parameters),
  }
}

export function consumeOAuthSession(state: string | null): OAuthSession | null {
  if (!state) {
    return null
  }

  cleanupExpiredSessions()

  const session = sessions.get(state)
  if (!session) {
    return null
  }

  sessions.delete(state)
  return session
}
