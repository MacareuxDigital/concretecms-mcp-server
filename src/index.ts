import { main } from './main.js'

main().catch((error) => {
  console.error('[concretecms-mcp] Error in MCP server:', error)
  process.exit(1)
})
