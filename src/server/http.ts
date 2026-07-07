import { createServer, type Server } from 'node:http'
import { attachOAuthHandlers } from '../auth/oauthHandlers.js'
import { MultiUserAuthProvider } from '../auth/MultiUserAuthProvider.js'
import { attachAuthMiddleware } from './authMiddleware.js'

export function createSharedHttpServer(authProvider: MultiUserAuthProvider): Server {
  const server = createServer()
  attachAuthMiddleware(server)
  attachOAuthHandlers(server, authProvider)
  return server
}
