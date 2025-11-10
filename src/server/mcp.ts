// @ts-ignore
import { OpenAPIServer, AuthProvider } from '@ivotoby/openapi-mcp-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { canonical_url } from '../env.js'
import { OPENAPI_SPEC_FILE } from '../paths.js'

export async function startMcpServer(authProvider: AuthProvider): Promise<void> {
  console.error('[concretecms-mcp] Starting MCP server...')

  const openApiServerConfig = {
    name: 'Concrete CMS',
    version: '1.0.0',
    apiBaseUrl: canonical_url,
    openApiSpec: OPENAPI_SPEC_FILE,
    specInputMethod: 'file' as const,
    transportType: 'stdio' as const,
    toolMode: 'all' as const,
    authProvider,
  }

  const openApiServer = new OpenAPIServer(openApiServerConfig)
  const transport = new StdioServerTransport()
  await openApiServer.start(transport)
}
