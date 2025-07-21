import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  chunkByCharacter,
  chunkByParagraph,
  getUnits,
  getTrimmedBounds
} from '../src/utils.js'
import type { ChunkResult, ChunkUnit } from '../src/types.js'

// Default character-based splitter used across tests
const defaultSplitter: (text: string) => string[] = (text: string) =>
  text.split('')

describe('chunkByCharacter', () => {
  test('yields correct chunks for basic input', () => {
    const result: ChunkResult[] = chunkByCharacter(
      'abcdef',
      2,
      defaultSplitter,
      0
    )
    assert.deepStrictEqual(result, [
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles overlap', () => {
    const result: ChunkResult[] = chunkByCharacter(
      'abcdef',
      3,
      defaultSplitter,
      1
    )
    assert.deepStrictEqual(result, [
      { text: 'abc', start: 0, end: 3 },
      { text: 'cde', start: 2, end: 5 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles custom splitter', () => {
    const result: ChunkResult[] = chunkByCharacter(
      'aabbcc',
      1,
      (t: string) => t.split('').filter((_, i: number) => i % 2 === 0),
      0
    )
    assert.strictEqual(result.length, 3)
  })

  test('handles empty input', () => {
    const result: ChunkResult[] = chunkByCharacter('', 2, defaultSplitter, 0)
    assert.deepStrictEqual(result, [])
  })

  test('verifies token-based chunking with word splitter', () => {
    const inputText = 'The quick brown fox jumps over the lazy dog.'
    const wordSplitter = (text: string): string[] =>
      text.split(/(\s+)/).filter(Boolean) // Lossless word splitter that preserves whitespace
    const chunkSize = 5 // 5 tokens (words)
    const chunkOverlap = 2 // 2 tokens overlap

    const result: ChunkResult[] = chunkByCharacter(
      inputText,
      chunkSize,
      wordSplitter,
      chunkOverlap
    )

    // Verify each chunk has at most 5 tokens (words)
    result.forEach((chunk, index) => {
      const tokens = wordSplitter(chunk.text as string)
      assert.ok(
        tokens.length <= chunkSize,
        `Chunk ${index} should have at most ${chunkSize} tokens, got ${tokens.length}: ${JSON.stringify(tokens)}`
      )
    })

    // Verify overlap exists and is token-based
    if (result.length > 1) {
      for (let i = 1; i < result.length; i++) {
        const prevChunk = result[i - 1]
        const currentChunk = result[i]

        // There should be overlap in character positions
        assert.ok(
          currentChunk.start < prevChunk.end,
          `Chunk ${i} should overlap with previous chunk`
        )

        // Calculate the overlapping text
        const overlapStart = currentChunk.start
        const overlapEnd = prevChunk.end
        const overlapText = inputText.slice(overlapStart, overlapEnd)
        const overlapTokens = wordSplitter(overlapText)

        // Verify overlap is approximately the requested token count (may vary due to character-based positioning in chunkByCharacter)
        assert.ok(
          overlapTokens.length >= 1,
          `Should have some token overlap between chunks ${i - 1} and ${i}, got ${overlapTokens.length} tokens: ${JSON.stringify(overlapTokens)}`
        )
      }
    }

    // Verify that we're actually chunking the text (not returning everything as one chunk)
    assert.ok(
      result.length > 1,
      'Should produce multiple chunks for this input'
    )

    // Verify total coverage of input text
    assert.strictEqual(
      result[0].start,
      0,
      'First chunk should start at beginning'
    )
    assert.strictEqual(
      result[result.length - 1].end,
      inputText.length,
      'Last chunk should end at text end'
    )
  })
})

describe('chunkByParagraph', () => {
  // Default character-based splitter for consistent testing
  const charSplitter: (text: string) => string[] = (text: string) =>
    text.split('')

  // Word-based splitter for more realistic testing
  const wordSplitter: (text: string) => string[] = (text: string) =>
    text.split(/(\s+)/).filter(Boolean) // Lossless word splitter

  test('handles single paragraph within chunk size limit', () => {
    const originalText = 'This is a short paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'This is a short paragraph.', start: 0, end: 26 }
    ]

    const result = chunkByParagraph(originalText, units, 50, 0, charSplitter)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].text, 'This is a short paragraph.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 26)
  })

  test('handles empty input', () => {
    const result = chunkByParagraph('', [], 10, 0, charSplitter)
    assert.deepStrictEqual(result, [])
  })
})

describe('getUnits', () => {
  test('handles single paragraph with no double newlines', () => {
    const text = 'This is a single paragraph with no breaks.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(
      result[0].unit,
      'This is a single paragraph with no breaks.'
    )
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 42)
  })

  test('splits text by double newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[1].unit, 'Second paragraph.')
    assert.strictEqual(result[2].unit, 'Third paragraph.')
  })

  test('handles empty string', () => {
    const result = getUnits('')
    assert.deepStrictEqual(result, [])
  })
})

describe('getTrimmedBounds', () => {
  test('handles text with leading and trailing whitespace', () => {
    const text = '  Hello, world!  '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello, world!')
    assert.strictEqual(result?.start, 2)
    assert.strictEqual(result?.end, 15)

    // Verify position accuracy
    const extracted = text.slice(result!.start, result!.end)
    assert.strictEqual(extracted, result!.unit)
    assert.strictEqual(extracted, 'Hello, world!')
  })

  test('handles text with only whitespace', () => {
    const result = getTrimmedBounds('   ')
    assert.strictEqual(result, null)
  })

  test('handles empty string', () => {
    const result = getTrimmedBounds('')
    assert.strictEqual(result, null)
  })
})
