import { test, describe } from 'node:test'
import assert from 'node:assert'
import { chunkByCharacter, chunkByParagraph, getUnits } from '../src/utils.js'
import type { ChunkResult, ChunkUnit } from '../src/types.js'

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

describe('chunkByParagraph', () => {
  // Default character-based splitter for consistent testing
  const charSplitter: (text: string) => string[] = (text: string) => text.split('')

  // Word-based splitter for more realistic testing
  const wordSplitter: (text: string) => string[] = (text: string) =>
    text.split(/\s+/).filter(word => word.length > 0)

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

  test('handles multiple small paragraphs within chunk size limit', () => {
    const originalText = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'First paragraph.', start: 0, end: 16 },
      { unit: 'Second paragraph.', start: 18, end: 35 },
      { unit: 'Third paragraph.', start: 37, end: 53 }
    ]

    const result = chunkByParagraph(originalText, units, 100, 0, charSplitter)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].text, 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 53)
  })

  test('splits paragraphs when combined size exceeds limit', () => {
    const originalText = 'First paragraph.\n\nSecond paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'First paragraph.', start: 0, end: 16 },
      { unit: 'Second paragraph.', start: 18, end: 35 }
    ]

    const result = chunkByParagraph(originalText, units, 20, 0, charSplitter)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].text, 'First paragraph.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 16)
    assert.strictEqual(result[1].text, 'Second paragraph.')
    assert.strictEqual(result[1].start, 18)
    assert.strictEqual(result[1].end, 35)
  })

  test('sub-chunks oversized single paragraph with no overlap', () => {
    const originalText = 'A'.repeat(150) // 150 characters
    const units: ChunkUnit[] = [
      { unit: 'A'.repeat(150), start: 0, end: 150 }
    ]

    const result = chunkByParagraph(originalText, units, 100, 0, charSplitter)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].text, 'A'.repeat(100))
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 100)
    assert.strictEqual(result[1].text, 'A'.repeat(50))
    assert.strictEqual(result[1].start, 100)
    assert.strictEqual(result[1].end, 150)
  })

  test('sub-chunks oversized single paragraph with overlap', () => {
    const originalText = 'ABCDEFGHIJ'.repeat(15) // 150 characters
    const units: ChunkUnit[] = [
      { unit: 'ABCDEFGHIJ'.repeat(15), start: 0, end: 150 }
    ]

    const result = chunkByParagraph(originalText, units, 100, 10, charSplitter)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].text.length, 100)
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 100)
    assert.strictEqual(result[1].start, 90) // 100 - 10 overlap
    assert.strictEqual(result[1].end, 150)
    assert.strictEqual(result[1].text.length, 60) // 150 - 90
  })

  test('handles multiple oversized paragraphs', () => {
    const firstPara = 'A'.repeat(150)
    const secondPara = 'B'.repeat(120)
    const originalText = firstPara + '\n\n' + secondPara
    const units: ChunkUnit[] = [
      { unit: firstPara, start: 0, end: 150 },
      { unit: secondPara, start: 152, end: 272 }
    ]

    const result = chunkByParagraph(originalText, units, 100, 0, charSplitter)

    assert.strictEqual(result.length, 4)
    // First paragraph sub-chunks
    assert.strictEqual(result[0].text, 'A'.repeat(100))
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 100)
    assert.strictEqual(result[1].text, 'A'.repeat(50))
    assert.strictEqual(result[1].start, 100)
    assert.strictEqual(result[1].end, 150)
    // Second paragraph sub-chunks
    assert.strictEqual(result[2].text, 'B'.repeat(100))
    assert.strictEqual(result[2].start, 152)
    assert.strictEqual(result[2].end, 252)
    assert.strictEqual(result[3].text, 'B'.repeat(20))
    assert.strictEqual(result[3].start, 252)
    assert.strictEqual(result[3].end, 272)
  })

  test('handles overlap between multiple paragraphs', () => {
    const originalText = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'First paragraph.', start: 0, end: 16 },
      { unit: 'Second paragraph.', start: 18, end: 35 },
      { unit: 'Third paragraph.', start: 37, end: 53 }
    ]

    const result = chunkByParagraph(originalText, units, 30, 5, charSplitter)

    assert.ok(result.length >= 2)
    // Verify overlap exists between chunks
    if (result.length > 1) {
      assert.ok(result[0].end > result[1].start, 'Should have overlap between chunks')
    }
  })

  test('handles empty input', () => {
    const result = chunkByParagraph('', [], 100, 0, charSplitter)
    assert.deepStrictEqual(result, [])
  })

  test('handles single character paragraphs', () => {
    const originalText = 'A\n\nB\n\nC'
    const units: ChunkUnit[] = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 3, end: 4 },
      { unit: 'C', start: 6, end: 7 }
    ]

    const result = chunkByParagraph(originalText, units, 3, 0, charSplitter)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].text, 'A\n\nB\n\nC')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 7)
  })

  test('works with word-based splitter', () => {
    const originalText = 'This is the first paragraph with many words.\n\nThis is the second paragraph with many words too.'
    const units: ChunkUnit[] = [
      { unit: 'This is the first paragraph with many words.', start: 0, end: 45 },
      { unit: 'This is the second paragraph with many words too.', start: 47, end: 97 }
    ]

    const result = chunkByParagraph(originalText, units, 8, 0, wordSplitter) // 8 words max

    assert.ok(result.length >= 2)
    // Each chunk should respect word boundaries and token limits
    result.forEach(chunk => {
      const wordCount = wordSplitter(chunk.text as string).length
      assert.ok(wordCount <= 8, `Chunk should have <= 8 words, got ${wordCount}`)
    })
  })

  test('maintains chunk boundaries with word splitter and overlap', () => {
    const originalText = 'One two three four five.\n\nSix seven eight nine ten.'
    const units: ChunkUnit[] = [
      { unit: 'One two three four five.', start: 0, end: 24 },
      { unit: 'Six seven eight nine ten.', start: 26, end: 51 }
    ]

    const result = chunkByParagraph(originalText, units, 4, 1, wordSplitter) // 4 words, 1 word overlap

    assert.ok(result.length >= 2)
    // Verify overlap exists
    if (result.length > 1) {
      assert.ok(result[0].end > result[1].start, 'Should have positional overlap')
    }
  })

  test('handles zero chunk size gracefully', () => {
    const originalText = 'Test paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'Test paragraph.', start: 0, end: 15 }
    ]

    const result = chunkByParagraph(originalText, units, 0, 0, charSplitter)

    // Should still produce at least one chunk with minimal content
    assert.ok(result.length > 0)
    assert.ok(result[0].text.length > 0)
  })

  test('handles overlap larger than chunk size', () => {
    const originalText = 'A'.repeat(100)
    const units: ChunkUnit[] = [
      { unit: 'A'.repeat(100), start: 0, end: 100 }
    ]

    const result = chunkByParagraph(originalText, units, 20, 30, charSplitter)

    // Should still produce chunks despite overlap > chunk size
    assert.ok(result.length > 0)
    assert.strictEqual(result[0].start, 0)
  })

  test('preserves exact character positions for getChunk compatibility', () => {
    const originalText = 'First paragraph here.\n\nSecond paragraph there.\n\nThird paragraph everywhere.'
    const units = getUnits(originalText)

    const result = chunkByParagraph(originalText, units, 30, 5, charSplitter)

    // Verify each chunk can be extracted exactly using its positions
    result.forEach((chunk, index) => {
      const extractedText = originalText.slice(chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        extractedText,
        `Chunk ${index} text should match extracted text from positions`
      )
    })
  })

  test('handles complex mixed paragraph sizes', () => {
    const shortPara = 'Short.'
    const mediumPara = 'This is a medium length paragraph with some content.'
    const longPara = 'This is a very long paragraph that definitely exceeds our chunk size limit and should be automatically sub-chunked into smaller pieces while maintaining proper character position tracking.'
    const originalText = shortPara + '\n\n' + mediumPara + '\n\n' + longPara

    const units = getUnits(originalText)
    const result = chunkByParagraph(originalText, units, 50, 10, charSplitter)

    // Should handle all paragraph types appropriately
    assert.ok(result.length >= 3) // At least one chunk per paragraph type

    // Verify position accuracy
    result.forEach((chunk, index) => {
      const extractedText = originalText.slice(chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        extractedText,
        `Chunk ${index} positions should be accurate`
      )
    })
  })

  test('maintains overlap accuracy with binary search positioning', () => {
    const originalText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(5) // 130 chars
    const units: ChunkUnit[] = [
      { unit: originalText, start: 0, end: 130 }
    ]

    const result = chunkByParagraph(originalText, units, 50, 15, charSplitter)

    assert.ok(result.length >= 2)

    // Verify overlap positions are accurate
    for (let i = 1; i < result.length; i++) {
      const prevChunk = result[i - 1]
      const currentChunk = result[i]

      // There should be overlap
      assert.ok(currentChunk.start < prevChunk.end, 'Should have overlap')

      // Verify overlapped text can be extracted correctly
      const overlapText = originalText.slice(currentChunk.start, prevChunk.end)
      assert.ok(overlapText.length > 0, 'Overlap text should exist')
    }
  })
})
