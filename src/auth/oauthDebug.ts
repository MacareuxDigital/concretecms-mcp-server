import { oauthDebug } from '../env.js'

export type OAuthCallbackFailureReason =
  | 'oauth_provider_error'
  | 'missing_authorization_code'
  | 'no_pending_sessions'
  | 'pkce_match_failed'
  | 'user_id_mismatch'
  | 'resolve_cms_user_failed'
  | 'token_persistence_failed'
  | 'post_exchange_failed'

export interface OAuthCallbackFailure {
  reason: OAuthCallbackFailureReason
  message: string
  detail?: string
  context?: Record<string, unknown>
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function describeOAuthError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error'
  }

  const parts = [error.message]
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    parts.push(`cause: ${cause.message}`)
  }

  const oauthError = (error as Error & { error?: string }).error
  if (typeof oauthError === 'string' && oauthError.length > 0) {
    parts.push(`oauth_error: ${oauthError}`)
  }

  const oauthDescription = (error as Error & { error_description?: string }).error_description
  if (typeof oauthDescription === 'string' && oauthDescription.length > 0) {
    parts.push(`oauth_error_description: ${oauthDescription}`)
  }

  return parts.join(' | ')
}

export function logOAuthCallbackEvent(message: string, context?: Record<string, unknown>): void {
  if (!context || Object.keys(context).length === 0) {
    console.error(`[concretecms-mcp] ${message}`)
    return
  }

  console.error(`[concretecms-mcp] ${message} ${JSON.stringify(context)}`)
}

export function logOAuthCallbackFailure(failure: OAuthCallbackFailure): void {
  logOAuthCallbackEvent(`OAuth callback failed: ${failure.reason}`, {
    message: failure.message,
    ...(failure.detail ? { detail: failure.detail } : {}),
    ...(failure.context ?? {}),
  })
}

export function formatOAuthFailureHtmlBody(failure: OAuthCallbackFailure): string {
  const lines = [
    `<h1>Authorization Failed</h1>`,
    `<p>${escapeHtml(failure.message)}</p>`,
  ]

  if (oauthDebug) {
    lines.push(`<p><strong>Reason:</strong> <code>${escapeHtml(failure.reason)}</code></p>`)
    if (failure.detail) {
      lines.push(`<pre>${escapeHtml(failure.detail)}</pre>`)
    }
    if (failure.context && Object.keys(failure.context).length > 0) {
      lines.push(`<pre>${escapeHtml(JSON.stringify(failure.context, null, 2))}</pre>`)
    }
    lines.push(
      '<p><em>Server logs contain the same reason. Set <code>OAUTH_DEBUG=0</code> to hide this detail in the browser.</em></p>'
    )
  }

  return lines.join('\n')
}
