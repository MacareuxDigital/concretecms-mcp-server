import { RefreshTokenGrantProvider } from './auth/RefreshTokenGrantProvider.js'
import { performOAuthFlow } from './auth/oauthFlow.js'
import { startMcpServer } from './server/mcp.js'

export async function main(): Promise<void> {
  const authProvider = new RefreshTokenGrantProvider()

  const hasStoredTokens = authProvider.loadStoredTokens()

  if (hasStoredTokens) {
    try {
      await authProvider.getAuthHeaders()
      console.error('[concretecms-mcp] Tokens validated successfully')
    } catch (error) {
      console.error('[concretecms-mcp] Stored tokens invalid, starting OAuth flow...')
      await performOAuthFlow(authProvider)
    }
  } else {
    console.error('[concretecms-mcp] No stored tokens found, starting OAuth flow...')
    await performOAuthFlow(authProvider)
  }

  await startMcpServer(authProvider)
}
