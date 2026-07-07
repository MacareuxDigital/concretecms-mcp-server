import { OAuthLock, releaseOAuthLock } from './oauthLock.js'
import { performOAuthFlow } from './oauthFlow.js'
import { transportType } from '../env.js'
import { hasTokens, loadTokens, needsTokenRefresh } from '../tokenStore.js'
import { UserTokenSession } from './UserTokenSession.js'

const authPromises = new Map<string, Promise<void>>()

export async function ensureAuthenticated(session: UserTokenSession): Promise<void> {
  const userId = session.getUserId()

  if (session.isAuthenticated() && !needsTokenRefresh(session.getExpiresAt())) {
    return
  }

  if (session.loadStoredTokens() && session.isAuthenticated() && !needsTokenRefresh(session.getExpiresAt())) {
    return
  }

  const existing = authPromises.get(userId)
  if (existing) {
    return existing
  }

  const promise = runAuthenticatedFlow(session)
  authPromises.set(userId, promise)

  try {
    await promise
  } finally {
    authPromises.delete(userId)
  }
}

async function runAuthenticatedFlow(session: UserTokenSession): Promise<void> {
  const userId = session.getUserId()
  const lock = new OAuthLock(userId)

  if (lock.tryAcquire()) {
    try {
      if (session.loadStoredTokens() && session.isAuthenticated() && !needsTokenRefresh(session.getExpiresAt())) {
        return
      }

      if (transportType === 'stdio') {
        await performOAuthFlow(session)
        session.loadStoredTokens()
        return
      }

      throw new Error('Not authenticated for this session. Authorize via /oauth/start.')
    } finally {
      lock.release()
    }
  }

  await lock.waitForRelease()

  if (session.loadStoredTokens() && session.isAuthenticated()) {
    return
  }

  if (hasTokens(userId) && loadTokens(userId)) {
    session.loadStoredTokens()
    return
  }

  return ensureAuthenticated(session)
}

export function acquireOAuthStartLock(lockUserId: string): OAuthLock | null {
  const lock = new OAuthLock(lockUserId)
  return lock.tryAcquire() ? lock : null
}

export function releaseOAuthStartLock(lockUserId: string): void {
  releaseOAuthLock(lockUserId)
}
