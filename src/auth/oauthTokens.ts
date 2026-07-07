import * as client from 'openid-client'
import { config } from './oidc.js'
import { saveTokens, type StoredTokens } from '../tokenStore.js'
import { resolveCmsUserId } from './resolveUser.js'

export type StoredTokensWithParameters = StoredTokens & {
  parameters: Record<string, string>
}

export async function exchangeAuthorizationCode(
  callbackUrl: URL,
  codeVerifier: string,
  expectedState?: string | null
): Promise<client.TokenEndpointResponse> {
  return client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    ...(expectedState ? { expectedState } : {}),
  })
}

export async function saveTokensForUser(
  tokens: client.TokenEndpointResponse,
  parameters: Record<string, string>,
  intendedUserId?: number
): Promise<{ userId: string; stored: StoredTokensWithParameters }> {
  const now = Date.now()
  const expiresAt = now + tokens.expires_in! * 1000
  const cmsUserId = await resolveCmsUserId(tokens.access_token)

  if (intendedUserId !== undefined && intendedUserId !== cmsUserId) {
    throw new Error(
      `Authorized user (${cmsUserId}) does not match intended user (${intendedUserId})`
    )
  }

  const userId = String(cmsUserId)
  const stored: StoredTokensWithParameters = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token!,
    expires_at: expiresAt,
    obtained_at: now,
    parameters,
    cms_user_id: cmsUserId,
    authorized_at: now,
  }

  saveTokens(userId, stored, parameters)
  return { userId, stored }
}

export async function saveTokensForStdioUser(
  userId: string,
  tokens: client.TokenEndpointResponse,
  parameters: Record<string, string>
): Promise<StoredTokensWithParameters> {
  const now = Date.now()
  const expiresAt = now + tokens.expires_in! * 1000
  const stored: StoredTokensWithParameters = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token!,
    expires_at: expiresAt,
    obtained_at: now,
    parameters,
    authorized_at: now,
  }

  saveTokens(userId, stored, parameters)
  return stored
}
