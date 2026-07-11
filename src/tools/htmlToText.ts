const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Convert HTML to plain text for reading/summarizing.
 * Strips tags, decodes common entities, and normalizes whitespace.
 */
export function htmlToText(html: string): string {
  if (!html) {
    return ''
  }

  let text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|tr|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => decodeEntity(entity))

  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return text
}

function decodeEntity(entity: string): string {
  const lower = entity.toLowerCase()
  if (ENTITY_MAP[lower]) {
    return ENTITY_MAP[lower]
  }

  if (lower.startsWith('#x')) {
    const code = Number.parseInt(lower.slice(2), 16)
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`
  }

  if (lower.startsWith('#')) {
    const code = Number.parseInt(lower.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`
  }

  return `&${entity};`
}
