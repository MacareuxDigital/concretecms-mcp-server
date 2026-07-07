import * as client from 'openid-client'
import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { config } from './oidc.js'
import { httpPort, scope, stdioUserKey } from '../env.js'
import { UserTokenSession } from './UserTokenSession.js'
import { exchangeAuthorizationCode, saveTokensForStdioUser } from './oauthTokens.js'
import { redactError } from '../utils/redact.js'

export async function performOAuthFlow(authProvider: UserTokenSession): Promise<void> {
  const redirect_uri = `http://localhost:${httpPort}/callback`
  const code_verifier = client.randomPKCECodeVerifier()
  const code_challenge = await client.calculatePKCECodeChallenge(code_verifier)

  const parameters: Record<string, string> = {
    redirect_uri,
    scope: scope || 'account:read',
    code_challenge,
    code_challenge_method: 'S256',
  }

  const redirectTo = client.buildAuthorizationUrl(config, parameters)

  return new Promise<void>((resolve, reject) => {
    const TIMEOUT_MS = 10 * 60 * 1000
    let timeoutId: NodeJS.Timeout

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${httpPort}`)

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
          const getCurrentUrl = () => new URL(req.url!, `http://localhost:${httpPort}`)
          console.error('[concretecms-mcp] Processing local OAuth callback')
          const tokens = await exchangeAuthorizationCode(getCurrentUrl(), code_verifier)
          const stored = await saveTokensForStdioUser(stdioUserKey, tokens, parameters)
          authProvider.applyTokens(stored)

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
          console.error(`[concretecms-mcp] Token exchange failed: ${redactError(error)}`)

          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authorization Failed</title>
            </head>
            <body>
              <h1>Authorization Failed</h1>
              <p>Authorization could not be completed. Please try again.</p>
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
        console.error(`[concretecms-mcp] Port ${httpPort} is already in use.`)
        console.error('[concretecms-mcp] Please close the application using this port or run:')
        console.error(`[concretecms-mcp]   lsof -ti:${httpPort} | xargs kill -9`)
        reject(new Error(`Port ${httpPort} is already in use. Please free the port and try again.`))
      } else {
        console.error(`[concretecms-mcp] Server error: ${redactError(error)}`)
        reject(error)
      }
    })

    httpServer.listen(httpPort, '127.0.0.1', () => {
      console.error(`[concretecms-mcp] Local server started on http://localhost:${httpPort}`)
      console.error('[concretecms-mcp] Server will automatically stop after 10 minutes if not used')
      console.error('[concretecms-mcp] Opening browser...')

      timeoutId = setTimeout(() => {
        console.error('[concretecms-mcp] OAuth server timed out after 10 minutes')
        httpServer.close()
        reject(new Error('OAuth authentication timed out. Please try again.'))
      }, TIMEOUT_MS)

      const platform = process.platform
      let command: string

      if (platform === 'darwin') {
        command = `open "http://localhost:${httpPort}"`
      } else if (platform === 'win32') {
        command = `start "" "http://localhost:${httpPort}"`
      } else {
        command = `xdg-open "http://localhost:${httpPort}"`
      }

      exec(command, (error) => {
        if (error) {
          console.error('[concretecms-mcp] Failed to open browser automatically.')
          console.error(`[concretecms-mcp] Please open this URL manually: http://localhost:${httpPort}`)
        }
      })
    })
  })
}
