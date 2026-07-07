/**
 * Remove expired per-user token files and stale OAuth lockfiles.
 * Run after build: npm run build && npm run cleanup:tokens
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

process.env.TRANSPORT_TYPE = process.env.TRANSPORT_TYPE ?? 'stdio'
process.env.CONCRETE_CANONICAL_URL = process.env.CONCRETE_CANONICAL_URL ?? 'https://example.com'
process.env.CONCRETE_API_CLIENT_ID = process.env.CONCRETE_API_CLIENT_ID ?? 'cleanup'
process.env.CONCRETE_API_CLIENT_SECRET = process.env.CONCRETE_API_CLIENT_SECRET ?? 'cleanup'
process.env.CONCRETE_API_SCOPE = process.env.CONCRETE_API_SCOPE ?? 'account:read'

const { cleanupExpiredTokens } = await import(`file://${join(projectRoot, 'dist/tokenStore.js')}`)
const { cleanupStaleOAuthLocks } = await import(`file://${join(projectRoot, 'dist/auth/oauthLock.js')}`)

const locksRemoved = cleanupStaleOAuthLocks()
const tokensRemoved = cleanupExpiredTokens()

console.log(`Removed ${locksRemoved} stale OAuth lock(s) and ${tokensRemoved} expired token file(s).`)
