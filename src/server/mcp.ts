import {
  OpenAPIServer,
  AuthProvider,
  StreamableHttpServerTransport,
} from '@ivotoby/openapi-mcp-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Server } from 'node:http'
import {
  canonical_url,
  httpHost,
  httpPort,
  mcpEndpointPath,
  oauthStartPath,
  publicBaseUrl,
  transportType,
} from '../env.js'
import { OPENAPI_SPEC_FILE } from '../paths.js'
import { createPageTools } from '../tools/pageTools.js'

export interface McpServerOptions {
  transport?: 'stdio' | 'http'
  httpServer?: Server
}

export async function startMcpServer(
  authProvider: AuthProvider,
  options: McpServerOptions = {}
): Promise<void> {
  const transport = options.transport ?? transportType
  console.error(`[concretecms-mcp] Starting MCP server (${transport} transport)...`)

  const openApiServerConfig = {
    name: 'Concrete CMS',
    version: '1.0.0',
    apiBaseUrl: canonical_url,
    openApiSpec: OPENAPI_SPEC_FILE,
    specInputMethod: 'file' as const,
    transportType: transport,
    httpPort,
    httpHost,
    endpointPath: mcpEndpointPath,
    toolsMode: 'all' as const,
    disableAbbreviation: true,
    authProvider,
    extraTools: createPageTools(authProvider),
  }

  const openApiServer = new OpenAPIServer(openApiServerConfig)

  if (transport === 'http') {
    if (!options.httpServer) {
      throw new Error('HTTP transport requires a shared HTTP server instance')
    }

    const httpTransport = new StreamableHttpServerTransport(
      httpPort,
      httpHost,
      mcpEndpointPath,
      options.httpServer,
      false
    )

    await openApiServer.start(httpTransport)
    console.error(
      `[concretecms-mcp] Remote MCP server running at ${publicBaseUrl}${mcpEndpointPath}`
    )
    console.error(`[concretecms-mcp] OAuth start URL: ${publicBaseUrl}${oauthStartPath}`)
    return
  }

  const stdioTransport = new StdioServerTransport()
  await openApiServer.start(stdioTransport)
}
