import { canonical_url } from '../env.js'

interface AccountUser {
  id?: number | string
}

interface AccountResponse {
  id?: number | string
  data?: AccountUser
}

function parseUserId(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function extractUserId(body: AccountResponse): number | null {
  return parseUserId(body.data?.id ?? body.id)
}

export { extractUserId }

export async function resolveCmsUserId(accessToken: string): Promise<number> {
  const url = `${canonical_url.replace(/\/$/, '')}/ccm/api/1.0/account`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve CMS user (HTTP ${response.status})`)
  }

  const body = (await response.json()) as AccountResponse
  const userId = extractUserId(body)
  if (!userId) {
    throw new Error('Failed to resolve CMS user ID from account response')
  }

  return userId
}
