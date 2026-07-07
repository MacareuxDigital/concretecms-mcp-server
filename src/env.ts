function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name]
  if (!value) {
    return defaultValue
  }

  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for environment variable ${name}: ${value}`)
  }

  return parsed
}

export function normalizePathPrefix(prefix: string): string {
  if (!prefix || prefix === '/') {
    return ''
  }

  const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
  return normalized.replace(/\/$/, '')
}

function prefixedPath(segment: string, envName: string, pathPrefix: string): string {
  const defaultPath = pathPrefix ? `${pathPrefix}${segment}` : segment
  return optionalEnv(envName, defaultPath)
}

export const canonical_url = requireEnv('CONCRETE_CANONICAL_URL')
export const client_id = requireEnv('CONCRETE_API_CLIENT_ID')
export const client_secret = requireEnv('CONCRETE_API_CLIENT_SECRET')
export const scope = requireEnv('CONCRETE_API_SCOPE')

export type TransportType = 'stdio' | 'http'

const transportTypeValue = optionalEnv('TRANSPORT_TYPE', 'stdio')
if (transportTypeValue !== 'stdio' && transportTypeValue !== 'http') {
  throw new Error(`Invalid TRANSPORT_TYPE: ${transportTypeValue}. Must be 'stdio' or 'http'.`)
}

export const transportType = transportTypeValue as TransportType
export const httpHost = optionalEnv('HTTP_HOST', transportType === 'http' ? '0.0.0.0' : '127.0.0.1')
export const httpPort = optionalIntEnv('HTTP_PORT', 3000)
export const pathPrefix = normalizePathPrefix(optionalEnv('PATH_PREFIX', ''))
export const mcpEndpointPath = prefixedPath('/mcp', 'MCP_ENDPOINT_PATH', pathPrefix)
export const oauthCallbackPath = prefixedPath('/oauth/callback', 'OAUTH_CALLBACK_PATH', pathPrefix)
export const oauthStartPath = prefixedPath('/oauth/start', 'OAUTH_START_PATH', pathPrefix)
export const oauthStatusPath = prefixedPath('/oauth/status', 'OAUTH_STATUS_PATH', pathPrefix)
export const healthPath = prefixedPath('/health', 'HEALTH_PATH', pathPrefix)

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export const publicBaseUrl = (() => {
  const url = process.env.PUBLIC_BASE_URL

  if (transportType === 'http') {
    if (!url) {
      throw new Error('Missing required environment variable: PUBLIC_BASE_URL (required when TRANSPORT_TYPE=http)')
    }
    return normalizeBaseUrl(url)
  }

  return normalizeBaseUrl(url ?? `http://localhost:${httpPort}`)
})()

export const oauthRedirectUri = `${publicBaseUrl}${oauthCallbackPath}`
