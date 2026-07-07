import { canonical_url } from '../env.js'

interface AccountResponse {
  id: number
}

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

  const data = (await response.json()) as AccountResponse
  if (!data.id || data.id <= 0) {
    throw new Error('Failed to resolve CMS user ID from account response')
  }

  return data.id
}
