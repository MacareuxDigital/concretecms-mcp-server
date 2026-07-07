/**
 * Local verification for token store encryption and HTTP auth middleware.
 * Run after build: npm run build && node scripts/verify-security.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = mkdtempSync(join(tmpdir(), 'concretecms-mcp-test-'))
const tokenDir = join(testDir, 'tokens')
const encryptionKey = Buffer.alloc(32, 7).toString('base64')
const mcpApiKey = 'test-mcp-api-key-12345678'

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

function baseEnv(overrides = {}) {
  return {
    TOKEN_DIR: tokenDir,
    TOKEN_ENCRYPTION_KEY: encryptionKey,
    TRANSPORT_TYPE: 'http',
    PUBLIC_BASE_URL: 'http://127.0.0.1:3999',
    MCP_API_KEY: mcpApiKey,
    CONCRETE_CANONICAL_URL: 'https://cms.example.com',
    CONCRETE_API_CLIENT_ID: 'test-client',
    CONCRETE_API_CLIENT_SECRET: 'test-secret',
    CONCRETE_API_SCOPE: 'account:read',
    HTTP_PORT: '3999',
    HTTP_HOST: '127.0.0.1',
    ...overrides,
  }
}

async function importTokenStore(env) {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }

  return import(`file://${join(projectRoot, 'dist/tokenStore.js')}?t=${Date.now()}`)
}

console.log('Token store tests')

const { saveTokens, loadTokens, clearTokens } = await importTokenStore(baseEnv())

const sampleTokens = {
  access_token: 'access-abc',
  refresh_token: 'refresh-xyz',
  expires_at: Date.now() + 3_600_000,
  parameters: { redirect_uri: 'http://localhost/callback', scope: 'account:read' },
  cms_user_id: 42,
}

saveTokens('42', sampleTokens, sampleTokens.parameters)
const loaded = await loadTokens('42')
assert(loaded?.access_token === 'access-abc', 'encrypt/decrypt round-trip')
assert(existsSync(join(tokenDir, '42.tokens.json')), 'per-user tokens file created')
assert(existsSync(join(tokenDir, '42.client.json')), 'per-user client file created')

const raw = readFileSync(join(tokenDir, '42.tokens.json'), 'utf-8')
const parsed = JSON.parse(raw)
assert(parsed.iv && parsed.tag && parsed.data, 'file is encrypted envelope')
assert((statSync(join(tokenDir, '42.tokens.json')).mode & 0o777) === 0o600, 'file mode 0600')

clearTokens('42')
assert(!existsSync(join(tokenDir, '42.tokens.json')), 'clearTokens removes user tokens file')
assert(!existsSync(join(tokenDir, '42.client.json')), 'clearTokens removes user client file')

console.log('\nLegacy migration test (stdio subprocess)')

const legacyDir = mkdtempSync(join(tmpdir(), 'concretecms-mcp-legacy-'))
const legacyTokenDir = join(legacyDir, 'tokens')
const legacyFile = join(legacyDir, '.tokens.json')
writeFileSync(legacyFile, JSON.stringify(sampleTokens), { mode: 0o600 })

const migration = spawn('node', ['-e', `
  process.env.TRANSPORT_TYPE = 'stdio';
  process.env.TOKEN_DIR = ${JSON.stringify(legacyTokenDir)};
  process.env.TOKEN_FILE = ${JSON.stringify(legacyFile)};
  process.env.CONCRETE_CANONICAL_URL = 'https://cms.example.com';
  process.env.CONCRETE_API_CLIENT_ID = 'test-client';
  process.env.CONCRETE_API_CLIENT_SECRET = 'test-secret';
  process.env.CONCRETE_API_SCOPE = 'account:read';
  import('./dist/tokenStore.js').then(m => {
    m.migrateLegacyTokens();
    process.exit(require('fs').existsSync(${JSON.stringify(join(legacyTokenDir, 'local.tokens.json'))}) ? 0 : 1);
  });
`], { cwd: projectRoot, stdio: 'inherit' })

await new Promise((resolve) => migration.on('close', resolve))
assert(migration.exitCode === 0, 'legacy .tokens.json migrates to local.tokens.json (stdio)')

console.log('\nHTTP server auth tests')

const server = spawn('node', ['dist/index.js'], {
  cwd: projectRoot,
  env: { ...process.env, ...baseEnv() },
  stdio: ['ignore', 'pipe', 'pipe'],
})

await new Promise((resolve) => setTimeout(resolve, 2500))

async function request(path, headers = {}, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:3999${path}`, { headers, method })
  return { status: response.status, body: await response.text() }
}

try {
  const noAuth = await request('/mcp', { 'Content-Type': 'application/json' }, 'POST')
  assert(noAuth.status === 401, '/mcp returns 401 without MCP_API_KEY')

  const noUser = await request(
    '/mcp',
    { Authorization: `Bearer ${mcpApiKey}`, 'Content-Type': 'application/json' },
    'POST'
  )
  assert(noUser.status === 400, '/mcp returns 400 without X-Concrete-User-Id')

  const health = await request('/health')
  assert(health.status === 200, '/health is public')

  const oauthNoAuth = await request('/oauth/status?user_id=42')
  assert(oauthNoAuth.status === 401, '/oauth/status requires MCP_API_KEY')
} catch (error) {
  console.error('HTTP tests error:', error.message)
  failed++
} finally {
  server.kill()
}

rmSync(testDir, { recursive: true, force: true })
rmSync(legacyDir, { recursive: true, force: true })

console.log(`\nResults: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
