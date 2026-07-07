import { createServer, type Server } from 'node:http'
import { attachOAuthHandlers } from '../auth/oauthHandlers.js'
import { RefreshTokenGrantProvider } from '../auth/RefreshTokenGrantProvider.js'

export function createSharedHttpServer(authProvider: RefreshTokenGrantProvider): Server {
  const server = createServer()
  attachOAuthHandlers(server, authProvider)
  return server
}
