import { existsSync, readFileSync, writeFileSync } from 'fs'
import { TOKEN_FILE } from './paths.js'

export interface StoredTokens {
  access_token: string
  refresh_token: string
  expires_at: number
  parameters: Record<string, string>
}

export function loadTokens(): StoredTokens | null {
  try {
    if (existsSync(TOKEN_FILE)) {
      const data = readFileSync(TOKEN_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('[concretecms-mcp] Failed to load tokens:', error)
  }
  return null
}

export function saveTokens(tokens: StoredTokens): void {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    console.error('[concretecms-mcp] Tokens saved successfully')
  } catch (error) {
    console.error('[concretecms-mcp] Failed to save tokens:', error)
  }
}
