import type { AuthProvider } from '@ivotoby/openapi-mcp-server'
import { canonical_url } from '../env.js'

export class CmsApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, method: string, path: string) {
    super(`CMS API ${method} ${path} failed (${status}): ${body}`)
    this.name = 'CmsApiError'
    this.status = status
    this.body = body
  }
}

export class CmsApiClient {
  constructor(private readonly authProvider: AuthProvider) {}

  async get<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query)
    return this.request<T>('GET', url)
  }

  async put<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    const url = this.buildUrl(path)
    return this.request<T>('PUT', url, body)
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): URL {
    const base = canonical_url.replace(/\/$/, '')
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${base}${normalizedPath}`)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }

    return url
  }

  private async request<T>(method: string, url: URL, body?: unknown): Promise<T> {
    const authHeaders = await this.authProvider.getAuthHeaders()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeaders,
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init)
    const text = await response.text()

    if (!response.ok) {
      throw new CmsApiError(response.status, text.slice(0, 2000), method, url.pathname)
    }

    if (!text) {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`CMS API ${method} ${url.pathname} returned non-JSON response`)
    }
  }
}
