import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { TOKEN_DIR, LEGACY_TOKEN_FILE } from './paths.js'
import { getTokenEncryptionKey, stdioUserKey, transportType } from './env.js'

export interface StoredTokens {
  access_token: string
  refresh_token: string
  expires_at: number
  obtained_at?: number
  cms_user_id?: number
  authorized_at?: number
}

export interface StoredClientInfo {
  parameters: Record<string, string>
}

interface EncryptedEnvelope {
  v: number
  iv: string
  tag: string
  data: string
}

interface LegacyCombinedTokens extends StoredTokens {
  parameters: Record<string, string>
}

const ENCRYPTION_SALT = 'concretecms-mcp-token-v1'
const ENVELOPE_VERSION = 1
export const TOKEN_REFRESH_BUFFER_MS = 60_000
const DEFAULT_EXPIRED_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, ENCRYPTION_SALT, 32)
}

function getEncryptionKeyBuffer(): Buffer | null {
  const key = getTokenEncryptionKey()
  if (!key) {
    return null
  }

  try {
    const decoded = Buffer.from(key, 'base64')
    if (decoded.length === 32) {
      return decoded
    }
  } catch {
    // fall through to scrypt
  }

  return deriveKey(key)
}

function tokensFilePath(userId: string): string {
  return join(TOKEN_DIR, `${userId}.tokens.json`)
}

function clientFilePath(userId: string): string {
  return join(TOKEN_DIR, `${userId}.client.json`)
}

function legacyCombinedFilePath(userId: string): string {
  return join(TOKEN_DIR, `${userId}.json`)
}

function ensureTokenDir(): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 })
  }
}

function assertTokenDirSafe(): void {
  if (transportType !== 'http') {
    return
  }

  ensureTokenDir()

  const stat = statSync(TOKEN_DIR)
  const mode = stat.mode & 0o777
  if (mode & 0o002) {
    throw new Error(`TOKEN_DIR ${TOKEN_DIR} must not be world-writable`)
  }
}

function isLegacyPlaintext(parsed: unknown): parsed is LegacyCombinedTokens {
  return typeof parsed === 'object' && parsed !== null && 'access_token' in parsed
}

function encrypt(data: unknown): string {
  const key = getEncryptionKeyBuffer()
  const plaintext = JSON.stringify(data)

  if (!key) {
    return plaintext
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  }

  return JSON.stringify(envelope)
}

function decrypt<T>(raw: string): T {
  const parsed: unknown = JSON.parse(raw)

  if (isLegacyPlaintext(parsed)) {
    return parsed as T
  }

  const envelope = parsed as EncryptedEnvelope
  const key = getEncryptionKeyBuffer()
  if (!key) {
    throw new Error('Encrypted token file requires TOKEN_ENCRYPTION_KEY')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8')) as T
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, content, { mode: 0o600 })
  renameSync(tmpPath, filePath)
}

function readEncryptedFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null
  }

  const raw = readFileSync(filePath, 'utf-8')
  return decrypt<T>(raw)
}

function maybeReencryptPlaintext(filePath: string, data: unknown, raw: string): void {
  const parsed: unknown = JSON.parse(raw)
  if (isLegacyPlaintext(parsed) && getEncryptionKeyBuffer()) {
    atomicWrite(filePath, encrypt(data))
  }
}

function loadLegacyCombined(userId: string): (StoredTokens & { parameters: Record<string, string> }) | null {
  const legacyPath = legacyCombinedFilePath(userId)
  if (!existsSync(legacyPath)) {
    return null
  }

  try {
    const raw = readFileSync(legacyPath, 'utf-8')
    const combined = decrypt<LegacyCombinedTokens>(raw)
    const { parameters, ...tokens } = combined
    saveTokens(userId, tokens, parameters)
    unlinkSync(legacyPath)
    return { ...tokens, parameters }
  } catch {
    return null
  }
}

export function needsTokenRefresh(
  expiresAt: number | undefined,
  bufferMs = TOKEN_REFRESH_BUFFER_MS
): boolean {
  if (!expiresAt) {
    return true
  }

  return Date.now() >= expiresAt - bufferMs
}

export function saveTokens(
  userId: string,
  tokens: StoredTokens,
  parameters: Record<string, string>
): void {
  ensureTokenDir()
  assertTokenDirSafe()

  const now = Date.now()
  const tokenData: StoredTokens = {
    ...tokens,
    obtained_at: tokens.obtained_at ?? now,
    authorized_at: tokens.authorized_at ?? now,
  }

  atomicWrite(tokensFilePath(userId), encrypt(tokenData))
  atomicWrite(clientFilePath(userId), encrypt({ parameters } satisfies StoredClientInfo))
  console.error(`[concretecms-mcp] Tokens saved for user ${userId}`)
}

export function loadTokens(
  userId: string
): (StoredTokens & { parameters: Record<string, string> }) | null {
  try {
    ensureTokenDir()

    const legacy = loadLegacyCombined(userId)
    if (legacy) {
      return legacy
    }

    const tokensPath = tokensFilePath(userId)
    const clientPath = clientFilePath(userId)

    if (!existsSync(tokensPath)) {
      return null
    }

    const rawTokens = readFileSync(tokensPath, 'utf-8')
    const tokens = decrypt<StoredTokens>(rawTokens)
    maybeReencryptPlaintext(tokensPath, tokens, rawTokens)

    let parameters: Record<string, string> = {}
    if (existsSync(clientPath)) {
      const rawClient = readFileSync(clientPath, 'utf-8')
      const clientInfo = decrypt<StoredClientInfo>(rawClient)
      maybeReencryptPlaintext(clientPath, clientInfo, rawClient)
      parameters = clientInfo.parameters
    }

    return { ...tokens, parameters }
  } catch {
    console.error(`[concretecms-mcp] Failed to load tokens for user ${userId}`)
    return null
  }
}

export function clearTokens(userId?: string): void {
  if (userId) {
    for (const path of [
      tokensFilePath(userId),
      clientFilePath(userId),
      legacyCombinedFilePath(userId),
      join(TOKEN_DIR, `${userId}.auth.lock`),
    ]) {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
    return
  }

  if (!existsSync(TOKEN_DIR)) {
    return
  }

  for (const file of readdirSync(TOKEN_DIR)) {
    if (
      file.endsWith('.tokens.json') ||
      file.endsWith('.client.json') ||
      file.endsWith('.json') ||
      file.endsWith('.auth.lock')
    ) {
      unlinkSync(join(TOKEN_DIR, file))
    }
  }
}

export function hasTokens(userId: string): boolean {
  return (
    existsSync(tokensFilePath(userId)) || existsSync(legacyCombinedFilePath(userId))
  )
}

export function listAuthorizedUsers(): string[] {
  if (!existsSync(TOKEN_DIR)) {
    return []
  }

  const users = new Set<string>()

  for (const file of readdirSync(TOKEN_DIR)) {
    if (file.endsWith('.tokens.json')) {
      users.add(file.replace(/\.tokens\.json$/, ''))
    } else if (file.endsWith('.json') && !file.endsWith('.client.json')) {
      users.add(file.replace(/\.json$/, ''))
    }
  }

  return [...users]
}

export function cleanupExpiredTokens(maxAgeMs = DEFAULT_EXPIRED_TOKEN_AGE_MS): number {
  if (!existsSync(TOKEN_DIR)) {
    return 0
  }

  let removed = 0
  const now = Date.now()

  for (const userId of listAuthorizedUsers()) {
    const stored = loadTokens(userId)
    if (!stored) {
      continue
    }

    if (now - stored.expires_at > maxAgeMs) {
      clearTokens(userId)
      console.error(`[concretecms-mcp] Removed expired tokens for user ${userId}`)
      removed++
    }
  }

  return removed
}

export function migrateLegacyTokens(): void {
  if (!existsSync(LEGACY_TOKEN_FILE)) {
    return
  }

  if (transportType === 'http') {
    console.error(
      '[concretecms-mcp] Legacy .tokens.json found but http mode requires per-user tokens. Re-authorize each user via /oauth/start.'
    )
    return
  }

  try {
    const raw = readFileSync(LEGACY_TOKEN_FILE, 'utf-8')
    const combined = JSON.parse(raw) as LegacyCombinedTokens
    const { parameters, ...tokens } = combined
    saveTokens(stdioUserKey, tokens, parameters)
    unlinkSync(LEGACY_TOKEN_FILE)
    console.error(`[concretecms-mcp] Migrated legacy tokens to ${stdioUserKey}`)
  } catch {
    console.error('[concretecms-mcp] Failed to migrate legacy tokens')
  }
}
