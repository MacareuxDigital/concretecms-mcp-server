import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { siteKeyFromUrl } from './siteKey.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const PROJECT_ROOT = join(__dirname, '..')
export const LEGACY_TOKEN_FILE = process.env.TOKEN_FILE ?? join(PROJECT_ROOT, '.tokens.json')
export const OPENAPI_SPEC_FILE = join(PROJECT_ROOT, 'openapi.yml')

export function getTokenBaseDir(): string {
  return process.env.TOKEN_DIR ?? join(homedir(), '.concretecms-mcp', 'tokens')
}

export function getSiteKey(): string {
  const url = process.env.CONCRETE_CANONICAL_URL
  if (!url) {
    throw new Error('Missing required environment variable: CONCRETE_CANONICAL_URL')
  }

  return siteKeyFromUrl(url)
}

export function getTokenDir(): string {
  return join(getTokenBaseDir(), getSiteKey())
}
