import type { ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
  blockFurtherResponseWrites(res)
}

export function blockFurtherResponseWrites(res: ServerResponse): void {
  const noop = (): ServerResponse => res
  res.writeHead = noop as typeof res.writeHead
  res.setHeader = noop as typeof res.setHeader
  res.write = (() => true) as typeof res.write
  res.end = noop as typeof res.end
}
