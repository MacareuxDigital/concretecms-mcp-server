import type { AuthProvider, ExtraToolDefinition } from '@ivotoby/openapi-mcp-server'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { CmsApiClient, CmsApiError } from '../cms/apiClient.js'
import { htmlToText } from './htmlToText.js'
import {
  BlockRemapError,
  remapBlockIds,
  type BlockUpdateRequest,
  type PageArea,
} from './remapBlockIds.js'

interface PageContentResponse {
  id?: number
  path?: string
  name?: string
  description?: string
  version?: unknown
  content?: {
    content?: string
    raw?: string
  }
  areas?: PageArea[]
}

interface BlockUpdateResult {
  areaHandle: string
  oldBlockID: number
  newBlockID: number
  ok: boolean
  error?: string
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

function requirePageId(args: Record<string, unknown>): number {
  const pageID = args.pageID
  if (typeof pageID !== 'number' || !Number.isInteger(pageID) || pageID <= 0) {
    throw new Error('pageID must be a positive integer')
  }
  return pageID
}

function parseBlockUpdates(args: Record<string, unknown>): BlockUpdateRequest[] {
  const blocks = args.blocks
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('blocks must be a non-empty array')
  }

  return blocks.map((block, index) => {
    if (!block || typeof block !== 'object') {
      throw new Error(`blocks[${index}] must be an object`)
    }

    const item = block as Record<string, unknown>
    const areaHandle = item.areaHandle
    const blockID = item.blockID
    const value = item.value

    if (typeof areaHandle !== 'string' || !areaHandle) {
      throw new Error(`blocks[${index}].areaHandle must be a non-empty string`)
    }
    if (typeof blockID !== 'number' || !Number.isInteger(blockID) || blockID <= 0) {
      throw new Error(`blocks[${index}].blockID must be a positive integer`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`blocks[${index}].value must be an object`)
    }

    return {
      areaHandle,
      blockID,
      value: value as Record<string, unknown>,
    }
  })
}

async function handleGetPageContent(
  client: CmsApiClient,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    const pageID = requirePageId(args)
    const version =
      args.version === 'recent' || args.version === 'active' ? args.version : 'active'

    const page = await client.get<PageContentResponse>(`/ccm/api/1.0/pages/${pageID}`, {
      includes: 'content',
      version,
    })

    const html = page.content?.content ?? ''
    const htmlRaw = page.content?.raw ?? ''

    return jsonResult({
      id: page.id,
      path: page.path,
      name: page.name,
      description: page.description,
      version: page.version,
      html,
      html_raw: htmlRaw,
      text: htmlToText(html),
    })
  } catch (error) {
    return errorResult(formatToolError(error))
  }
}

async function handleUpdatePageContent(
  client: CmsApiClient,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    const pageID = requirePageId(args)
    const updates = parseBlockUpdates(args)
    const pageBody =
      args.page && typeof args.page === 'object' && !Array.isArray(args.page)
        ? (args.page as Record<string, unknown>)
        : {}

    const beforePage = await client.get<PageContentResponse>(`/ccm/api/1.0/pages/${pageID}`, {
      includes: 'areas',
      version: 'recent',
    })

    await client.put(`/ccm/api/1.0/pages/${pageID}`, pageBody)

    const afterPage = await client.get<PageContentResponse>(`/ccm/api/1.0/pages/${pageID}`, {
      includes: 'areas',
      version: 'recent',
    })

    const remapped = remapBlockIds(
      beforePage.areas ?? [],
      afterPage.areas ?? [],
      updates
    )

    const blockResults: BlockUpdateResult[] = []

    for (const update of remapped) {
      try {
        await client.put(
          `/ccm/api/1.0/pages/${pageID}/${encodeURIComponent(update.areaHandle)}/${update.newBlockID}`,
          { value: update.value }
        )
        blockResults.push({
          areaHandle: update.areaHandle,
          oldBlockID: update.oldBlockID,
          newBlockID: update.newBlockID,
          ok: true,
        })
      } catch (error) {
        blockResults.push({
          areaHandle: update.areaHandle,
          oldBlockID: update.oldBlockID,
          newBlockID: update.newBlockID,
          ok: false,
          error: formatToolError(error),
        })
      }
    }

    return jsonResult({
      id: afterPage.id ?? pageID,
      path: afterPage.path,
      name: afterPage.name,
      description: afterPage.description,
      version: afterPage.version,
      blocks: blockResults,
      note: 'Page version was not auto-approved. Use updatePageVersionByPageIdAndVersionId to approve if needed.',
    })
  } catch (error) {
    return errorResult(formatToolError(error))
  }
}

function formatToolError(error: unknown): string {
  if (error instanceof CmsApiError || error instanceof BlockRemapError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function createPageTools(authProvider: AuthProvider): ExtraToolDefinition[] {
  const client = new CmsApiClient(authProvider)

  return [
    {
      id: 'get_page_content',
      tool: {
        name: 'get_page_content',
        description:
          'Review a Concrete CMS page as a document. Returns sanitized HTML, raw HTML, and plain text. Prefer this over getPageById with includes=content when summarizing or reading page copy. Does not return areas/blocks.',
        inputSchema: {
          type: 'object',
          properties: {
            pageID: {
              type: 'number',
              description: 'ID of the page to read',
            },
            version: {
              type: 'string',
              enum: ['active', 'recent'],
              description: 'Page version to read. Defaults to active.',
            },
          },
          required: ['pageID'],
        },
      },
      handler: (args) => handleGetPageContent(client, args),
    },
    {
      id: 'update_page_content',
      tool: {
        name: 'update_page_content',
        description:
          'Update page block content safely. Creates a new editable page version (PUT page), remaps block IDs, then updates each block (PUT area). Provide blockID values from the version you inspected. Does not approve the new version.',
        inputSchema: {
          type: 'object',
          properties: {
            pageID: {
              type: 'number',
              description: 'ID of the page to update',
            },
            page: {
              type: 'object',
              description:
                'Optional page metadata for the PUT page step (name, description, type, template, attributes). Send empty/omit to only create a version.',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                type: { type: 'string' },
                template: { type: 'string' },
                attributes: { type: 'object' },
              },
            },
            blocks: {
              type: 'array',
              description:
                'Blocks to update. blockID must match the layout before this call; the tool remaps IDs after creating a new version.',
              items: {
                type: 'object',
                properties: {
                  areaHandle: {
                    type: 'string',
                    description: 'Area name (handle) containing the block',
                  },
                  blockID: {
                    type: 'number',
                    description: 'Block ID from the inspected page version',
                  },
                  value: {
                    type: 'object',
                    description:
                      'Block edit payload (same shape as the Concrete block editing form / UpdatedBlock.value)',
                  },
                },
                required: ['areaHandle', 'blockID', 'value'],
              },
            },
          },
          required: ['pageID', 'blocks'],
        },
      },
      handler: (args) => handleUpdatePageContent(client, args),
    },
  ]
}
