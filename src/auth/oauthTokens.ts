import * as client from 'openid-client'
import { config } from './oidc.js'
import { saveTokens } from '../tokenStore.js'
import { RefreshTokenGrantProvider } from './RefreshTokenGrantProvider.js'

export async function exchangeAuthorizationCode(
  callbackUrl: URL,
  codeVerifier: string
): Promise<client.TokenEndpointResponse> {
  return client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
  })
}

export function applyTokensToProvider(
  authProvider: RefreshTokenGrantProvider,
  tokens: client.TokenEndpointResponse,
  parameters: Record<string, string>
): void {
  const expiresAt = Date.now() + tokens.expires_in! * 1000

  authProvider.accessToken = tokens.access_token
  authProvider.refreshToken = tokens.refresh_token
  authProvider.expiresAt = expiresAt
  authProvider.parameters = parameters

  saveTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token!,
    expires_at: expiresAt,
    parameters,
  })
}
