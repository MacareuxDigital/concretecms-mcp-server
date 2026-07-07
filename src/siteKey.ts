import { createHash } from 'node:crypto'

export function normalizeSiteUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.replace(/\/$/, '')
    return `${parsed.origin}${pathname}`.toLowerCase()
  } catch {
    return url.replace(/\/$/, '').toLowerCase()
  }
}

export function siteKeyFromUrl(url: string): string {
  const normalized = normalizeSiteUrl(url)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}
