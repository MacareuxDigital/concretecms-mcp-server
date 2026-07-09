/**
 * Verify HTTP OAuth uses state-keyed in-memory sessions (proxied /oauth/start pattern).
 * Run after build: npm run verify:oauth
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  OK: ${message}`)
  } else {
    failed++
    console.error(`  FAIL: ${message}`)
  }
}

function baseEnv() {
  return {
    TRANSPORT_TYPE: 'http',
    PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    MCP_API_KEY: 'test-mcp-api-key',
    CONCRETE_CANONICAL_URL: 'https://cms.example.com',
    CONCRETE_API_CLIENT_ID: 'test-client',
    CONCRETE_API_CLIENT_SECRET: 'test-secret',
    CONCRETE_API_SCOPE: 'account:read',
  }
}

for (const [key, value] of Object.entries(baseEnv())) {
  process.env[key] = value
}

console.log('OAuth session binding tests')

const { createOAuthSession, consumeOAuthSession } = await import(
  `file://${join(projectRoot, 'dist/auth/oauthSession.js')}?t=${Date.now()}`
)

const { state, authorizationUrl } = await createOAuthSession(
  'http://127.0.0.1:3000/oauth/callback',
  'account:read',
  42,
  '42'
)

assert(typeof state === 'string' && state.length > 0, 'createOAuthSession returns state')
assert(
  authorizationUrl.searchParams.has('state'),
  'authorize URL includes state query parameter'
)
assert(
  authorizationUrl.searchParams.get('state') === state,
  'authorize URL state matches session state'
)
assert(
  authorizationUrl.searchParams.has('code_challenge'),
  'authorize URL includes PKCE code_challenge'
)

const session = consumeOAuthSession(state)
assert(session?.codeVerifier !== undefined, 'consumeOAuthSession(state) returns PKCE session')
assert(consumeOAuthSession(state) === null, 'session is single-use after consume')
assert(consumeOAuthSession('wrong-state') === null, 'unknown state returns null')

console.log('Shipped dist guardrails')

const oauthSessionSource = readFileSync(join(projectRoot, 'dist/auth/oauthSession.js'), 'utf8')
const oauthHandlersSource = readFileSync(join(projectRoot, 'dist/auth/oauthHandlers.js'), 'utf8')

assert(
  oauthSessionSource.includes('sessions.set(state'),
  'dist/oauthSession.js keys sessions by state'
)
assert(
  !oauthSessionSource.includes('concretecms_mcp_oauth_lock'),
  'dist/oauthSession.js does not use oauth lock cookie'
)
assert(
  !oauthHandlersSource.includes('concretecms_mcp_oauth_lock'),
  'dist/oauthHandlers.js does not set oauth lock cookie'
)
assert(
  oauthHandlersSource.includes("searchParams.get('state')"),
  'dist/oauthHandlers.js reads state from callback query'
)
assert(
  !oauthHandlersSource.includes('Set-Cookie'),
  'dist/oauthHandlers.js does not rely on Set-Cookie for OAuth'
)

console.log('')
if (failed > 0) {
  console.error(`OAuth verification failed: ${failed} failure(s), ${passed} passed`)
  process.exit(1)
}

console.log(`OAuth verification passed (${passed} checks)`)
