import { MultiUserAuthProvider } from './auth/MultiUserAuthProvider.js'
import { oauthStartPath, transportType, warnStdioEncryptionOnce } from './env.js'
import { startMcpServer } from './server/mcp.js'
import { createSharedHttpServer } from './server/http.js'
import { cleanupExpiredTokens, migrateLegacyTokens } from './tokenStore.js'
import { cleanupStaleOAuthLocks } from './auth/oauthLock.js'

async function startStdioServer(authProvider: MultiUserAuthProvider): Promise<void> {
  warnStdioEncryptionOnce()
  migrateLegacyTokens()
  cleanupStaleOAuthLocks()
  cleanupExpiredTokens()

  console.error('[concretecms-mcp] OAuth will run on first tool call if tokens are missing or expired')
  await startMcpServer(authProvider, { transport: 'stdio' })
}

async function startHttpServer(authProvider: MultiUserAuthProvider): Promise<void> {
  migrateLegacyTokens()
  cleanupStaleOAuthLocks()
  cleanupExpiredTokens()

  const httpServer = createSharedHttpServer(authProvider)
  await startMcpServer(authProvider, { transport: 'http', httpServer })

  console.error(`[concretecms-mcp] Remote MCP server ready. Authorize users via ${oauthStartPath}`)
}

export async function main(): Promise<void> {
  const authProvider = new MultiUserAuthProvider()

  if (transportType === 'http') {
    await startHttpServer(authProvider)
    return
  }

  await startStdioServer(authProvider)
}
