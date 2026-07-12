export interface AreaBlock {
  id: number
  type?: string
  value?: unknown
}

export interface PageArea {
  name: string
  blocks?: AreaBlock[]
}

export interface BlockUpdateRequest {
  areaHandle: string
  blockID: number
  value: Record<string, unknown>
}

export interface RemappedBlockUpdate {
  areaHandle: string
  oldBlockID: number
  newBlockID: number
  value: Record<string, unknown>
}

export class BlockRemapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockRemapError'
  }
}

/**
 * Map block IDs from a pre-version-create layout to post-version-create IDs
 * by matching area handle + index within each area.
 */
export function remapBlockIds(
  beforeAreas: PageArea[],
  afterAreas: PageArea[],
  updates: BlockUpdateRequest[]
): RemappedBlockUpdate[] {
  const idMap = buildIdMap(beforeAreas, afterAreas)

  return updates.map((update) => {
    const newBlockID = idMap.get(update.blockID)
    if (newBlockID === undefined) {
      throw new BlockRemapError(
        `Cannot remap block ${update.blockID} in area "${update.areaHandle}": ` +
          'block not found in the pre-update page layout'
      )
    }

    const afterArea = afterAreas.find((area) => area.name === update.areaHandle)
    if (!afterArea) {
      throw new BlockRemapError(
        `Area "${update.areaHandle}" not found on the page after creating a new version`
      )
    }

    const stillInArea = (afterArea.blocks ?? []).some((block) => block.id === newBlockID)
    if (!stillInArea) {
      throw new BlockRemapError(
        `Remapped block ${update.blockID} → ${newBlockID} is not in area "${update.areaHandle}" ` +
          'after creating a new version'
      )
    }

    return {
      areaHandle: update.areaHandle,
      oldBlockID: update.blockID,
      newBlockID,
      value: update.value,
    }
  })
}

function buildIdMap(beforeAreas: PageArea[], afterAreas: PageArea[]): Map<number, number> {
  const afterByName = new Map(afterAreas.map((area) => [area.name, area]))
  const idMap = new Map<number, number>()

  for (const beforeArea of beforeAreas) {
    const afterArea = afterByName.get(beforeArea.name)
    if (!afterArea) {
      continue
    }

    const beforeBlocks = beforeArea.blocks ?? []
    const afterBlocks = afterArea.blocks ?? []
    const count = Math.min(beforeBlocks.length, afterBlocks.length)

    for (let i = 0; i < count; i++) {
      idMap.set(beforeBlocks[i].id, afterBlocks[i].id)
    }
  }

  return idMap
}
