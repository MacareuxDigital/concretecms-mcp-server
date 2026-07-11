import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BlockRemapError, remapBlockIds } from './remapBlockIds.js'

describe('remapBlockIds', () => {
  const beforeAreas = [
    {
      name: 'Main',
      blocks: [
        { id: 10, type: 'content' },
        { id: 11, type: 'html' },
      ],
    },
    {
      name: 'Sidebar',
      blocks: [{ id: 20, type: 'content' }],
    },
  ]

  const afterAreas = [
    {
      name: 'Main',
      blocks: [
        { id: 110, type: 'content' },
        { id: 111, type: 'html' },
      ],
    },
    {
      name: 'Sidebar',
      blocks: [{ id: 120, type: 'content' }],
    },
  ]

  it('remaps by area handle and index', () => {
    const result = remapBlockIds(beforeAreas, afterAreas, [
      { areaHandle: 'Main', blockID: 11, value: { content: 'updated' } },
      { areaHandle: 'Sidebar', blockID: 20, value: { content: 'side' } },
    ])

    assert.deepEqual(result, [
      {
        areaHandle: 'Main',
        oldBlockID: 11,
        newBlockID: 111,
        value: { content: 'updated' },
      },
      {
        areaHandle: 'Sidebar',
        oldBlockID: 20,
        newBlockID: 120,
        value: { content: 'side' },
      },
    ])
  })

  it('throws when the old block ID is unknown', () => {
    assert.throws(
      () =>
        remapBlockIds(beforeAreas, afterAreas, [
          { areaHandle: 'Main', blockID: 999, value: {} },
        ]),
      BlockRemapError
    )
  })

  it('throws when remapped block is not in the requested area', () => {
    assert.throws(
      () =>
        remapBlockIds(beforeAreas, afterAreas, [
          { areaHandle: 'Sidebar', blockID: 10, value: {} },
        ]),
      /not in area "Sidebar"/
    )
  })
})
