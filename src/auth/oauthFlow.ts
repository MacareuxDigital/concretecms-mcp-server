import * as client from 'openid-client'
import { createServer } from 'http'
import { exec } from 'child_process'
import { config } from './oidc.js'
import { scope } from '../env.js'
import { saveTokens } from '../tokenStore.js'
import { RefreshTokenGrantProvider } from './RefreshTokenGrantProvider.js'

export async function performOAuthFlow(authProvider: RefreshTokenGrantProvider): Promise<void> {
  const redirect_uri = 'http://localhost:3000/callback'
  const code_verifier: string = client.randomPKCECodeVerifier()
  const code_challenge: string = await client.calculatePKCECodeChallenge(code_verifier)

  const parameters: Record<string, string> = {
    redirect_uri,
    scope: scope || 'account:read',
    code_challenge,
    code_challenge_method: 'S256',
  }

  const redirectTo: URL = client.buildAuthorizationUrl(config, parameters)

  return new Promise<void>((resolve, reject) => {
    const PORT = 3000
    const TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    let timeoutId: NodeJS.Timeout

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`)

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Redirecting to Authorization...</title>
          </head>
          <body>
            <h1>Redirecting to authorization page...</h1>
            <p>If you are not redirected automatically, <a href="${redirectTo.toString()}">click here</a>.</p>
            <script>
              window.location = "${redirectTo.toString()}";
            </script>
          </body>
          </html>
        `)
      } else if (url.pathname === '/callback') {
        try {
          const getCurrentUrl = () => new URL(req.url!, `http://localhost:${PORT}`)
          console.error('[concretecms-mcp] Received callback with code:', url.searchParams.get('code'))
          const tokens: client.TokenEndpointResponse = await client.authorizationCodeGrant(
            config,
            getCurrentUrl(),
            {
              pkceCodeVerifier: code_verifier,
            }
          )

          console.error('[concretecms-mcp] Token Endpoint Response', tokens)

          authProvider.accessToken = tokens.access_token
          authProvider.refreshToken = tokens.refresh_token
          const expiresAt = Date.now() + tokens.expires_in! * 1000
          authProvider.expiresAt = expiresAt
          authProvider.parameters = parameters

          saveTokens({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token!,
            expires_at: expiresAt,
            parameters,
          })

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authorization Successful</title>
            </head>
            <body>
              <h1>Authorization Successful!</h1>
              <p>You can close this window and return to the application.</p>
            </body>
            </html>
          `)

          clearTimeout(timeoutId)
          httpServer.close()
          resolve()
        } catch (error) {
          console.error('[concretecms-mcp] Token exchange failed:', error)

          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authorization Failed</title>
            </head>
            <body>
              <h1>Authorization Failed</h1>
              <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
            </body>
            </html>
          `)

          clearTimeout(timeoutId)
          httpServer.close()
          reject(error)
        }
      } else {
        res.writeHead(404)
        res.end('Not Found')
      }
    })

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[concretecms-mcp] Port ${PORT} is already in use.`)
        console.error(`[concretecms-mcp] Please close the application using this port or run:`)
        console.error(`[concretecms-mcp]   lsof -ti:${PORT} | xargs kill -9`)
        reject(new Error(`Port ${PORT} is already in use. Please free the port and try again.`))
      } else {
        console.error('[concretecms-mcp] Server error:', error)
        reject(error)
      }
    })

    httpServer.listen(PORT, () => {
      console.error(`[concretecms-mcp] Local server started on http://localhost:${PORT}`)
      console.error(`[concretecms-mcp] Server will automatically stop after 10 minutes if not used`)
      console.error(`[concretecms-mcp] Opening browser...`)

      timeoutId = setTimeout(() => {
        console.error('[concretecms-mcp] OAuth server timed out after 10 minutes')
        httpServer.close()
        reject(new Error('OAuth authentication timed out. Please try again.'))
      }, TIMEOUT_MS)

      const platform = process.platform
      let command: string

      if (platform === 'darwin') {
        command = `open "http://localhost:${PORT}"`
      } else if (platform === 'win32') {
        command = `start "" "http://localhost:${PORT}"`
      } else {
        command = `xdg-open "http://localhost:${PORT}"`
      }

      exec(command, (error) => {
        if (error) {
          console.error('[concretecms-mcp] Failed to open browser automatically.')
          console.error(`[concretecms-mcp] Please open this URL manually: http://localhost:${PORT}`)
        }
      })
    })
  })
}
