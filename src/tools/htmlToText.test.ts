import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { htmlToText } from './htmlToText.js'

describe('htmlToText', () => {
  it('strips tags and returns plain text', () => {
    assert.equal(htmlToText('<p>Hello <strong>world</strong></p>'), 'Hello world')
  })

  it('decodes common entities', () => {
    assert.equal(htmlToText('<p>A &amp; B &lt; C</p>'), 'A & B < C')
  })

  it('inserts newlines for block elements', () => {
    assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One\nTwo')
  })

  it('returns empty string for empty input', () => {
    assert.equal(htmlToText(''), '')
  })
})
