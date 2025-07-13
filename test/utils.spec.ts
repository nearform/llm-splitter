import { test, describe } from 'node:test'
import assert from 'node:assert'
import { chunkByCharacter } from '../src/utils.js'
import type { ChunkResult } from '../src/types.js'

// Default character-based splitter used across tests
const defaultSplitter: (text: string) => string[] = (text: string) =>
  text.split('')

describe('chunkByCharacter', () => {
  test('yields correct chunks for basic input', () => {
    const result: ChunkResult[] = Array.from(
      chunkByCharacter('abcdef', 2, defaultSplitter, 0)
    )
    assert.deepStrictEqual(result, [
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles overlap', () => {
    const result: ChunkResult[] = Array.from(
      chunkByCharacter('abcdef', 3, defaultSplitter, 1)
    )
    assert.deepStrictEqual(result, [
      { text: 'abc', start: 0, end: 3 },
      { text: 'cde', start: 2, end: 5 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles custom splitter', () => {
    const result: ChunkResult[] = Array.from(
      chunkByCharacter(
        'aabbcc',
        1,
        (t: string) => t.split('').filter((_, i: number) => i % 2 === 0),
        0
      )
    )
    assert.strictEqual(result.length, 3)
  })

  test('handles empty input', () => {
    const result: ChunkResult[] = Array.from(
      chunkByCharacter('', 2, defaultSplitter, 0)
    )
    assert.deepStrictEqual(result, [])
  })

  // Test for utils.ts:85 - bestEnd === start case
  test('handles edge case in chunkByCharacter where bestEnd equals start', () => {
    const result: ChunkResult[] = chunkByCharacter(
      'abc',
      0,
      defaultSplitter,
      0,
      0
    )
    assert.ok(result.length > 0) // Should still produce at least one chunk
    assert.strictEqual(result[0].text, 'a') // Should include at least one character
  })

  // Test for chunkByCharacter should handle case where bestEnd equals start with custom splitter
  test('chunkByCharacter should handle case where bestEnd equals start with custom splitter', () => {
    // Create a splitter that always returns large lengths to force bestEnd === start
    const splitter: (text: string) => string[] = () => new Array(1000).fill('x') // Always large
    const result: ChunkResult[] = chunkByCharacter('abc', 5, splitter, 0, 0)
    assert.strictEqual(result.length, 3) // Should force one char per chunk
    assert.strictEqual(result[0].text, 'a')
    assert.strictEqual(result[1].text, 'b')
    assert.strictEqual(result[2].text, 'c')
  })
})
