import { getCurrentUserId } from '../server/userContext.js'
import { stdioUserKey, transportType } from '../env.js'
import { ensureAuthenticated } from './authCoordinator.js'
import { UserTokenSession } from './UserTokenSession.js'

export class MultiUserAuthProvider {
  private readonly sessions = new Map<string, UserTokenSession>()

  private getSession(userId: string): UserTokenSession {
    let session = this.sessions.get(userId)
    if (!session) {
      session = new UserTokenSession(userId)
      session.loadStoredTokens()
      this.sessions.set(userId, session)
    }
    return session
  }

  private resolveUserId(): string {
    return getCurrentUserId() ?? stdioUserKey
  }

  getSessionForUser(userId: string): UserTokenSession {
    return this.getSession(userId)
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    const userId = this.resolveUserId()
    const session = this.getSession(userId)

    if (transportType === 'stdio') {
      await ensureAuthenticated(session)
    } else if (!session.isAuthenticated() && !session.loadStoredTokens()) {
      throw new Error('Not authenticated for this session')
    }

    return session.getAuthHeaders()
  }

  async handleAuthError(error: unknown): Promise<boolean> {
    const userId = this.resolveUserId()
    return this.getSession(userId).handleAuthError(error)
  }

  loadStoredTokens(userId?: string): boolean {
    const resolvedUserId = userId ?? this.resolveUserId()
    return this.getSession(resolvedUserId).loadStoredTokens()
  }

  isAuthenticated(userId?: string): boolean {
    const resolvedUserId = userId ?? this.resolveUserId()
    const session = this.getSession(resolvedUserId)
    return session.isAuthenticated() || session.loadStoredTokens()
  }

  getExpiresAt(userId?: string): number | undefined {
    const resolvedUserId = userId ?? this.resolveUserId()
    return this.getSession(resolvedUserId).getExpiresAt()
  }

  clearUser(userId: string): void {
    const session = this.sessions.get(userId)
    if (session) {
      session.clear()
      this.sessions.delete(userId)
    }
  }
}
