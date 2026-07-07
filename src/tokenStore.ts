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
import { getTokenBaseDir, getSiteKey, getTokenDir, LEGACY_TOKEN_FILE } from './paths.js'
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

function tokensFilePath(userId: string, tokenDir = getTokenDir()): string {
  return join(tokenDir, `${userId}.tokens.json`)
}

function clientFilePath(userId: string, tokenDir = getTokenDir()): string {
  return join(tokenDir, `${userId}.client.json`)
}

function legacyCombinedFilePath(userId: string, tokenDir = getTokenDir()): string {
  return join(tokenDir, `${userId}.json`)
}

function isTokenFile(filename: string): boolean {
  return (
    filename.endsWith('.tokens.json') ||
    filename.endsWith('.client.json') ||
    filename.endsWith('.auth.lock') ||
    (filename.endsWith('.json') && !filename.endsWith('.client.json'))
  )
}

function listTokenDirs(): string[] {
  const tokenDir = getTokenDir()
  const tokenBaseDir = getTokenBaseDir()
  if (!existsSync(tokenBaseDir)) {
    return [tokenDir]
  }

  const dirs = new Set<string>([tokenDir])

  for (const entry of readdirSync(tokenBaseDir)) {
    const path = join(tokenBaseDir, entry)
    if (statSync(path).isDirectory()) {
      dirs.add(path)
    }
  }

  return [...dirs]
}

function ensureTokenDir(tokenDir = getTokenDir()): void {
  if (!existsSync(tokenDir)) {
    mkdirSync(tokenDir, { recursive: true, mode: 0o700 })
  }
}

function assertTokenDirSafe(tokenDir = getTokenDir()): void {
  if (transportType !== 'http') {
    return
  }

  ensureTokenDir(tokenDir)

  const stat = statSync(tokenDir)
  const mode = stat.mode & 0o777
  if (mode & 0o002) {
    throw new Error(`TOKEN_DIR ${tokenDir} must not be world-writable`)
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

function maybeReencryptPlaintext(filePath: string, data: unknown, raw: string): void {
  const parsed: unknown = JSON.parse(raw)
  if (isLegacyPlaintext(parsed) && getEncryptionKeyBuffer()) {
    atomicWrite(filePath, encrypt(data))
  }
}

function loadLegacyCombined(
  userId: string,
  tokenDir = getTokenDir()
): (StoredTokens & { parameters: Record<string, string> }) | null {
  const legacyPath = legacyCombinedFilePath(userId, tokenDir)
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

export function migrateFlatTokenDir(): void {
  const tokenBaseDir = getTokenBaseDir()
  if (!existsSync(tokenBaseDir)) {
    return
  }

  ensureTokenDir()

  const tokenDir = getTokenDir()

  for (const file of readdirSync(tokenBaseDir)) {
    if (!isTokenFile(file)) {
      continue
    }

    const sourcePath = join(tokenBaseDir, file)
    if (!statSync(sourcePath).isFile()) {
      continue
    }

    const destPath = join(tokenDir, file)
    if (existsSync(destPath)) {
      continue
    }

    renameSync(sourcePath, destPath)
    console.error(`[concretecms-mcp] Migrated ${file} into site directory ${getSiteKey()}`)
  }
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
  console.error(`[concretecms-mcp] Tokens saved for user ${userId} (site ${getSiteKey()})`)
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
  const tokenDir = getTokenDir()

  if (userId) {
    for (const path of [
      tokensFilePath(userId, tokenDir),
      clientFilePath(userId, tokenDir),
      legacyCombinedFilePath(userId, tokenDir),
      join(tokenDir, `${userId}.auth.lock`),
    ]) {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
    return
  }

  if (!existsSync(tokenDir)) {
    return
  }

  for (const file of readdirSync(tokenDir)) {
    if (isTokenFile(file)) {
      unlinkSync(join(tokenDir, file))
    }
  }
}

export function hasTokens(userId: string): boolean {
  return (
    existsSync(tokensFilePath(userId)) || existsSync(legacyCombinedFilePath(userId))
  )
}

export function listAuthorizedUsers(tokenDir = getTokenDir()): string[] {
  if (!existsSync(tokenDir)) {
    return []
  }

  const users = new Set<string>()

  for (const file of readdirSync(tokenDir)) {
    if (file.endsWith('.tokens.json')) {
      users.add(file.replace(/\.tokens\.json$/, ''))
    } else if (file.endsWith('.json') && !file.endsWith('.client.json')) {
      users.add(file.replace(/\.json$/, ''))
    }
  }

  return [...users]
}

function cleanupExpiredTokensInDir(
  tokenDir: string,
  maxAgeMs = DEFAULT_EXPIRED_TOKEN_AGE_MS
): number {
  if (!existsSync(tokenDir)) {
    return 0
  }

  let removed = 0
  const now = Date.now()

  for (const userId of listAuthorizedUsers(tokenDir)) {
    const tokensPath = tokensFilePath(userId, tokenDir)
    if (!existsSync(tokensPath)) {
      continue
    }

    try {
      const raw = readFileSync(tokensPath, 'utf-8')
      const tokens = decrypt<StoredTokens>(raw)
      if (now - tokens.expires_at > maxAgeMs) {
        for (const path of [
          tokensFilePath(userId, tokenDir),
          clientFilePath(userId, tokenDir),
          legacyCombinedFilePath(userId, tokenDir),
          join(tokenDir, `${userId}.auth.lock`),
        ]) {
          if (existsSync(path)) {
            unlinkSync(path)
          }
        }
        console.error(`[concretecms-mcp] Removed expired tokens for user ${userId}`)
        removed++
      }
    } catch {
      // skip unreadable files
    }
  }

  return removed
}

export function cleanupExpiredTokens(maxAgeMs = DEFAULT_EXPIRED_TOKEN_AGE_MS): number {
  let removed = 0

  for (const tokenDir of listTokenDirs()) {
    removed += cleanupExpiredTokensInDir(tokenDir, maxAgeMs)
  }

  return removed
}

export function migrateLegacyTokens(): void {
  migrateFlatTokenDir()

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
    console.error(`[concretecms-mcp] Migrated legacy tokens to ${stdioUserKey} (site ${getSiteKey()})`)
  } catch {
    console.error('[concretecms-mcp] Failed to migrate legacy tokens')
  }
}
