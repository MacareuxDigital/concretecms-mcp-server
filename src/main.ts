import { RefreshTokenGrantProvider } from './auth/RefreshTokenGrantProvider.js'
import { performOAuthFlow } from './auth/oauthFlow.js'
import { oauthStartPath, transportType } from './env.js'
import { startMcpServer } from './server/mcp.js'
import { createSharedHttpServer } from './server/http.js'

async function startStdioServer(authProvider: RefreshTokenGrantProvider): Promise<void> {
  const hasStoredTokens = authProvider.loadStoredTokens()

  if (hasStoredTokens) {
    try {
      await authProvider.getAuthHeaders()
      console.error('[concretecms-mcp] Tokens validated successfully')
    } catch {
      console.error('[concretecms-mcp] Stored tokens invalid, starting OAuth flow...')
      await performOAuthFlow(authProvider)
    }
  } else {
    console.error('[concretecms-mcp] No stored tokens found, starting OAuth flow...')
    await performOAuthFlow(authProvider)
  }

  await startMcpServer(authProvider, { transport: 'stdio' })
}

async function startHttpServer(authProvider: RefreshTokenGrantProvider): Promise<void> {
  authProvider.loadStoredTokens()

  if (authProvider.isAuthenticated()) {
    try {
      await authProvider.getAuthHeaders()
      console.error('[concretecms-mcp] Tokens validated successfully')
    } catch {
      console.error(`[concretecms-mcp] Stored tokens invalid. Visit ${oauthStartPath} to re-authorize.`)
    }
  } else {
    console.error(`[concretecms-mcp] No stored tokens found. Visit ${oauthStartPath} to authorize.`)
  }

  const httpServer = createSharedHttpServer(authProvider)
  await startMcpServer(authProvider, { transport: 'http', httpServer })
}

export async function main(): Promise<void> {
  const authProvider = new RefreshTokenGrantProvider()

  if (transportType === 'http') {
    await startHttpServer(authProvider)
    return
  }

  await startStdioServer(authProvider)
}
