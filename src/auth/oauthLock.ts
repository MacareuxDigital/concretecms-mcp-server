import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { TOKEN_DIR } from '../paths.js'

const LOCK_MAX_AGE_MS = 10 * 60 * 1000
export const OAUTH_LOCK_WAIT_TIMEOUT_MS = 10 * 60 * 1000

interface LockData {
  pid: number
  timestamp: number
  hostname: string
}

function ensureTokenDir(): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 })
  }
}

function lockFilePath(userId: string): string {
  return join(TOKEN_DIR, `${userId}.auth.lock`)
}

function readLockData(path: string): LockData | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LockData
  } catch {
    return null
  }
}

function isLockValid(lockData: LockData): boolean {
  if (Date.now() - lockData.timestamp > LOCK_MAX_AGE_MS) {
    return false
  }

  try {
    process.kill(lockData.pid, 0)
    return true
  } catch {
    return false
  }
}

function removeLock(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export class OAuthLock {
  private isOwner = false
  private readonly path: string

  constructor(userId: string) {
    this.path = lockFilePath(userId)
  }

  tryAcquire(): boolean {
    ensureTokenDir()

    if (existsSync(this.path)) {
      const lockData = readLockData(this.path)
      if (lockData && isLockValid(lockData)) {
        return false
      }
      removeLock(this.path)
    }

    const lockData: LockData = {
      pid: process.pid,
      timestamp: Date.now(),
      hostname: hostname(),
    }

    writeFileSync(this.path, JSON.stringify(lockData), { mode: 0o600 })
    this.isOwner = true
    return true
  }

  release(): void {
    if (this.isOwner && existsSync(this.path)) {
      removeLock(this.path)
    }
    this.isOwner = false
  }

  async waitForRelease(timeout = OAUTH_LOCK_WAIT_TIMEOUT_MS): Promise<void> {
    const start = Date.now()

    return new Promise((resolve, reject) => {
      const check = () => {
        if (!existsSync(this.path)) {
          resolve()
          return
        }

        const lockData = readLockData(this.path)
        if (!lockData || !isLockValid(lockData)) {
          removeLock(this.path)
          resolve()
          return
        }

        if (Date.now() - start > timeout) {
          reject(new Error('Timeout waiting for OAuth lock'))
          return
        }

        setTimeout(check, 1000)
      }

      console.error('[concretecms-mcp] Waiting for another OAuth flow to complete...')
      check()
    })
  }
}

export function releaseOAuthLock(userId: string): void {
  removeLock(lockFilePath(userId))
}

export function cleanupStaleOAuthLocks(): number {
  if (!existsSync(TOKEN_DIR)) {
    return 0
  }

  let removed = 0

  for (const file of readdirSync(TOKEN_DIR)) {
    if (!file.endsWith('.auth.lock')) {
      continue
    }

    const path = join(TOKEN_DIR, file)
    const lockData = readLockData(path)
    if (!lockData || !isLockValid(lockData)) {
      removeLock(path)
      removed++
    }
  }

  return removed
}
