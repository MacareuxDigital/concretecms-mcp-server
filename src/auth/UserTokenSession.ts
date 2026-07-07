import * as client from 'openid-client'
import { config } from './oidc.js'
import { loadTokens, needsTokenRefresh, saveTokens } from '../tokenStore.js'
import { redactError } from '../utils/redact.js'

export type StoredSessionTokens = {
  access_token: string
  refresh_token: string
  expires_at: number
  obtained_at?: number
  parameters: Record<string, string>
  cms_user_id?: number
  authorized_at?: number
}

export class UserTokenSession {
  private _accessToken: string | undefined
  private _refreshToken: string | undefined
  private _expiresAt: number | undefined
  private _parameters: Record<string, string> | undefined

  constructor(private readonly userId: string) {}

  set accessToken(value: string | undefined) {
    this._accessToken = value
  }

  set refreshToken(value: string | undefined) {
    this._refreshToken = value
  }

  set expiresAt(value: number | undefined) {
    this._expiresAt = value
  }

  set parameters(value: Record<string, string> | undefined) {
    this._parameters = value
  }

  getUserId(): string {
    return this.userId
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this._accessToken) {
      throw new Error('Not authenticated for this session')
    }

    if (!this._refreshToken) {
      throw new Error('Not authenticated for this session')
    }

    if (needsTokenRefresh(this._expiresAt)) {
      await this.refreshAccessToken()
    }

    return {
      Authorization: `Bearer ${this._accessToken}`,
    }
  }

  async handleAuthError(error: unknown): Promise<boolean> {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 401 || status === 403) {
      try {
        await this.refreshAccessToken()
        return true
      } catch {
        console.error('[concretecms-mcp] Failed to refresh token, re-authentication required')
        throw new Error('Not authenticated for this session')
      }
    }

    return false
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this._refreshToken || !this._parameters) {
      throw new Error('Not authenticated for this session')
    }

    try {
      console.error(`[concretecms-mcp] Refreshing access token for user ${this.userId}...`)
      const tokenEndpointResponse: client.TokenEndpointResponse = await client.refreshTokenGrant(
        config,
        this._refreshToken,
        this._parameters
      )

      const now = Date.now()
      this._accessToken = tokenEndpointResponse.access_token
      this._expiresAt = now + tokenEndpointResponse.expires_in! * 1000

      if (tokenEndpointResponse.refresh_token) {
        this._refreshToken = tokenEndpointResponse.refresh_token
      }

      saveTokens(
        this.userId,
        {
          access_token: this._accessToken,
          refresh_token: this._refreshToken,
          expires_at: this._expiresAt,
          obtained_at: now,
        },
        this._parameters
      )

      console.error(`[concretecms-mcp] Access token refreshed for user ${this.userId}`)
    } catch (error) {
      console.error(`[concretecms-mcp] Token refresh failed for user ${this.userId}: ${redactError(error)}`)
      throw error
    }
  }

  loadStoredTokens(): boolean {
    const stored = loadTokens(this.userId)
    if (!stored) {
      return false
    }

    this.applyTokens(stored)
    return true
  }

  applyTokens(tokens: StoredSessionTokens): void {
    this._accessToken = tokens.access_token
    this._refreshToken = tokens.refresh_token
    this._expiresAt = tokens.expires_at
    this._parameters = tokens.parameters
  }

  clear(): void {
    this._accessToken = undefined
    this._refreshToken = undefined
    this._expiresAt = undefined
    this._parameters = undefined
  }

  isAuthenticated(): boolean {
    return !!(this._accessToken && this._refreshToken)
  }

  getExpiresAt(): number | undefined {
    return this._expiresAt
  }
}

// Backward-compatible alias for stdio OAuth flow
export { UserTokenSession as RefreshTokenGrantProvider }
