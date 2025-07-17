import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  chunkByCharacter,
  chunkByParagraph,
  getUnits,
  calculateOverlapStart,
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

  test('chunkByCharacter should handle case where bestEnd equals start with custom splitter', () => {
    // Create a splitter that always returns large lengths to force bestEnd === start
    const splitter: (text: string) => string[] = () => new Array(1000).fill('x') // Always large
    const result: ChunkResult[] = chunkByCharacter('abc', 5, splitter, 0, 0)
    assert.strictEqual(result.length, 3) // Should force one char per chunk
    assert.strictEqual(result[0].text, 'a')
    assert.strictEqual(result[1].text, 'b')
    assert.strictEqual(result[2].text, 'c')
  })

  test('verifies token-based chunking with word splitter', () => {
    const inputText = 'The quick brown fox jumps over the lazy dog.'
    const wordSplitter = (text: string): string[] =>
      text.split(/\s+/).filter(word => word.length > 0)
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
    const originalText =
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'First paragraph.', start: 0, end: 16 },
      { unit: 'Second paragraph.', start: 18, end: 35 },
      { unit: 'Third paragraph.', start: 37, end: 53 }
    ]

    const result = chunkByParagraph(originalText, units, 100, 0, charSplitter)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(
      result[0].text,
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    )
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
    const units: ChunkUnit[] = [{ unit: 'A'.repeat(150), start: 0, end: 150 }]

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
    const originalText =
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const units: ChunkUnit[] = [
      { unit: 'First paragraph.', start: 0, end: 16 },
      { unit: 'Second paragraph.', start: 18, end: 35 },
      { unit: 'Third paragraph.', start: 37, end: 53 }
    ]

    const result = chunkByParagraph(originalText, units, 30, 5, charSplitter)

    assert.ok(result.length >= 2)
    // Verify overlap exists between chunks
    if (result.length > 1) {
      assert.ok(
        result[0].end > result[1].start,
        'Should have overlap between chunks'
      )
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
    const originalText =
      'This is the first paragraph with many words.\n\nThis is the second paragraph with many words too.'
    const units: ChunkUnit[] = [
      {
        unit: 'This is the first paragraph with many words.',
        start: 0,
        end: 45
      },
      {
        unit: 'This is the second paragraph with many words too.',
        start: 47,
        end: 97
      }
    ]

    const result = chunkByParagraph(originalText, units, 8, 0, wordSplitter) // 8 words max

    assert.ok(result.length >= 2)
    // Each chunk should respect word boundaries and token limits
    result.forEach(chunk => {
      const wordCount = wordSplitter(chunk.text as string).length
      assert.ok(
        wordCount <= 8,
        `Chunk should have <= 8 words, got ${wordCount}`
      )
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
      assert.ok(
        result[0].end > result[1].start,
        'Should have positional overlap'
      )
    }
  })

  test('handles zero chunk size gracefully', () => {
    const originalText = 'Test paragraph.'
    const units: ChunkUnit[] = [{ unit: 'Test paragraph.', start: 0, end: 15 }]

    const result = chunkByParagraph(originalText, units, 0, 0, charSplitter)

    // Should still produce at least one chunk with minimal content
    assert.ok(result.length > 0)
    assert.ok(result[0].text.length > 0)
  })

  test('handles overlap larger than chunk size', () => {
    const originalText = 'A'.repeat(100)
    const units: ChunkUnit[] = [{ unit: 'A'.repeat(100), start: 0, end: 100 }]

    const result = chunkByParagraph(originalText, units, 20, 30, charSplitter)

    // Should still produce chunks despite overlap > chunk size
    assert.ok(result.length > 0)
    assert.strictEqual(result[0].start, 0)
  })

  test('preserves exact character positions for getChunk compatibility', () => {
    const originalText =
      'First paragraph here.\n\nSecond paragraph there.\n\nThird paragraph everywhere.'
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
    const longPara =
      'This is a very long paragraph that definitely exceeds our chunk size limit and should be automatically sub-chunked into smaller pieces while maintaining proper character position tracking.'
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
    const units: ChunkUnit[] = [{ unit: originalText, start: 0, end: 130 }]

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

  test('verifies token-based chunking with word splitter', () => {
    const inputText = 'The quick brown fox jumps over the lazy dog.'
    const wordSplitter = (text: string): string[] =>
      text.split(/\s+/).filter(word => word.length > 0)
    const chunkSize = 5 // 5 tokens (words)
    const chunkOverlap = 2 // 2 tokens overlap

    // Create a single paragraph unit for the entire text
    const units: ChunkUnit[] = [
      { unit: inputText, start: 0, end: inputText.length }
    ]

    const result = chunkByParagraph(
      inputText,
      units,
      chunkSize,
      chunkOverlap,
      wordSplitter
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

        // Verify overlap is exactly the requested token count (chunkByParagraph uses calculateOverlapStart for precise token-based overlap)
        assert.strictEqual(
          overlapTokens.length,
          chunkOverlap,
          `Should have exactly ${chunkOverlap} token overlap between chunks ${i - 1} and ${i}, got ${overlapTokens.length} tokens: ${JSON.stringify(overlapTokens)}`
        )
      }
    }

    // Verify that we're actually chunking the text (not returning everything as one chunk)
    assert.ok(
      result.length > 1,
      'Should produce multiple chunks for this input'
    )

    // Verify total coverage of input text (first chunk starts at beginning, coverage should be reasonable)
    assert.strictEqual(
      result[0].start,
      0,
      'First chunk should start at beginning'
    )
  })
})

describe('calculateOverlapStart', () => {
  // Default character-based splitter
  const charSplitter: (text: string) => string[] = (text: string) =>
    text.split('')

  // Word-based splitter for more realistic testing
  const wordSplitter: (text: string) => string[] = (text: string) =>
    text.split(/\s+/).filter(word => word.length > 0)

  test('handles zero overlap', () => {
    const originalText = 'ABCDEFGHIJKLMNOP'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGH',
      start: 0,
      end: 8
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      0,
      charSplitter
    )

    assert.strictEqual(
      result,
      8,
      'Should return end of previous chunk when overlap is 0'
    )
  })

  test('handles overlap within available tokens - character splitter', () => {
    const originalText = 'ABCDEFGHIJKLMNOP'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGH',
      start: 0,
      end: 8
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      3,
      charSplitter
    )

    assert.strictEqual(
      result,
      5,
      'Should return position 3 characters before end (8-3=5)'
    )

    // Verify the overlap text is exactly 3 characters
    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText, 'FGH')
    assert.strictEqual(charSplitter(overlapText).length, 3)
  })

  test('handles overlap equal to all available tokens', () => {
    const originalText = 'ABCDEFGH'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGH',
      start: 0,
      end: 8
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      8,
      charSplitter
    )

    assert.strictEqual(
      result,
      0,
      'Should return start of chunk when overlap equals chunk size'
    )

    // Verify the overlap includes the entire chunk
    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText, 'ABCDEFGH')
    assert.strictEqual(charSplitter(overlapText).length, 8)
  })

  test('handles overlap larger than available tokens', () => {
    const originalText = 'ABCDEFGH'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGH',
      start: 0,
      end: 8
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      15,
      charSplitter
    )

    assert.strictEqual(
      result,
      0,
      'Should return start of chunk when overlap exceeds available tokens'
    )

    // Verify we get all available tokens
    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText, 'ABCDEFGH')
    assert.strictEqual(charSplitter(overlapText).length, 8)
  })

  test('works with word-based splitter', () => {
    const originalText = 'The quick brown fox jumps over the lazy dog'
    const prevChunk: ChunkResult = {
      text: 'The quick brown fox jumps',
      start: 0,
      end: 25
    }

    // Test overlap of 1 word
    const result1 = calculateOverlapStart(originalText, prevChunk, 1, wordSplitter)
    const overlapText1 = originalText.slice(result1, prevChunk.end)
    const overlapWords1 = wordSplitter(overlapText1)
    
    assert.strictEqual(overlapWords1.length, 1)
    assert.deepStrictEqual(overlapWords1, ['jumps'])
    assert.ok(overlapText1.includes('jumps'))
    assert.strictEqual(result1, 19) // Binary search finds position that includes preceding space
    assert.strictEqual(overlapText1, ' jumps')

    // Test overlap of 2 words
    const result2 = calculateOverlapStart(originalText, prevChunk, 2, wordSplitter)
    const overlapText2 = originalText.slice(result2, prevChunk.end)
    const overlapWords2 = wordSplitter(overlapText2)

    assert.strictEqual(overlapWords2.length, 2)
    assert.deepStrictEqual(overlapWords2, ['fox', 'jumps'])
    assert.ok(overlapText2.includes('fox jumps'))
    assert.strictEqual(result2, 15) // Binary search finds position that includes preceding space
    assert.strictEqual(overlapText2, ' fox jumps')

    // Test overlap of 3 words
    const result3 = calculateOverlapStart(originalText, prevChunk, 3, wordSplitter)
    const overlapText3 = originalText.slice(result3, prevChunk.end)
    const overlapWords3 = wordSplitter(overlapText3)

    assert.strictEqual(overlapWords3.length, 3)
    assert.deepStrictEqual(overlapWords3, ['brown', 'fox', 'jumps'])
    assert.ok(overlapText3.includes('brown fox jumps'))
    assert.strictEqual(result3, 9) // Binary search finds position that includes preceding space
    assert.strictEqual(overlapText3, ' brown fox jumps')

    // Test overlap of 4 words
    const result4 = calculateOverlapStart(originalText, prevChunk, 4, wordSplitter)
    const overlapText4 = originalText.slice(result4, prevChunk.end)
    const overlapWords4 = wordSplitter(overlapText4)

    assert.strictEqual(overlapWords4.length, 4)
    assert.deepStrictEqual(overlapWords4, ['quick', 'brown', 'fox', 'jumps'])
    assert.ok(overlapText4.includes('quick brown fox jumps'))
    assert.strictEqual(result4, 3) // Binary search finds position that includes preceding space
    assert.strictEqual(overlapText4, ' quick brown fox jumps')

    // Test overlap of all 5 words (entire chunk)
    const result5 = calculateOverlapStart(originalText, prevChunk, 5, wordSplitter)
    const overlapText5 = originalText.slice(result5, prevChunk.end)
    const overlapWords5 = wordSplitter(overlapText5)

    assert.strictEqual(overlapWords5.length, 5)
    assert.deepStrictEqual(overlapWords5, ['The', 'quick', 'brown', 'fox', 'jumps'])
    assert.strictEqual(overlapText5, 'The quick brown fox jumps')
    assert.strictEqual(result5, 0) // Should start at beginning of chunk

    // Test overlap larger than available words (should use all available)
    const result6 = calculateOverlapStart(originalText, prevChunk, 10, wordSplitter)
    const overlapText6 = originalText.slice(result6, prevChunk.end)
    const overlapWords6 = wordSplitter(overlapText6)

    assert.strictEqual(overlapWords6.length, 5) // Still only 5 words available
    assert.deepStrictEqual(overlapWords6, ['The', 'quick', 'brown', 'fox', 'jumps'])
    assert.strictEqual(overlapText6, 'The quick brown fox jumps')
    assert.strictEqual(result6, 0) // Should start at beginning of chunk

    // Verify that each overlap position is correct by checking character positions
    assert.ok(result1 > result2, 'Position for 1-word overlap should be after 2-word overlap')
    assert.ok(result2 > result3, 'Position for 2-word overlap should be after 3-word overlap')
    assert.ok(result3 > result4, 'Position for 3-word overlap should be after 4-word overlap')
    assert.ok(result4 > result5, 'Position for 4-word overlap should be after 5-word overlap')
    assert.strictEqual(result5, result6, 'Excessive overlap should equal full chunk overlap')

    // Verify the binary search algorithm correctly identifies token boundaries
    // Each overlap should include exactly the requested number of tokens
    assert.strictEqual(wordSplitter(overlapText1).length, 1, '1-word overlap should have exactly 1 token')
    assert.strictEqual(wordSplitter(overlapText2).length, 2, '2-word overlap should have exactly 2 tokens')
    assert.strictEqual(wordSplitter(overlapText3).length, 3, '3-word overlap should have exactly 3 tokens')
    assert.strictEqual(wordSplitter(overlapText4).length, 4, '4-word overlap should have exactly 4 tokens')
    assert.strictEqual(wordSplitter(overlapText5).length, 5, '5-word overlap should have exactly 5 tokens')
    assert.strictEqual(wordSplitter(overlapText6).length, 5, 'Excessive overlap should have all available tokens')

    // Verify that the overlap correctly preserves token boundaries and may include whitespace
    // for accurate token counting as expected by the binary search precision algorithm
    assert.ok(overlapText1.startsWith(' '), '1-word overlap may include preceding whitespace for precision')
    assert.ok(overlapText2.startsWith(' '), '2-word overlap may include preceding whitespace for precision')
    assert.ok(overlapText3.startsWith(' '), '3-word overlap may include preceding whitespace for precision')
    assert.ok(overlapText4.startsWith(' '), '4-word overlap may include preceding whitespace for precision')
  })

  test('handles single character tokens', () => {
    const originalText = 'A B C D E F'
    const prevChunk: ChunkResult = {
      text: 'A B C D',
      start: 0,
      end: 7
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      2,
      wordSplitter
    )

    // Should overlap the last 2 words: "C D"
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 2)
    assert.deepStrictEqual(overlapWords, ['C', 'D'])
  })

  test('handles chunk not starting at position 0', () => {
    const originalText = 'PREFIX_ABCDEFGHIJKLMNOP_SUFFIX'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGH',
      start: 7,
      end: 15
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      3,
      charSplitter
    )

    assert.strictEqual(
      result,
      12,
      'Should return position 3 characters before end (15-3=12)'
    )

    // Verify the overlap text
    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText, 'FGH')
    assert.strictEqual(charSplitter(overlapText).length, 3)
  })

  test('handles complex text with special characters', () => {
    const originalText = 'Hello, world! How are you today? Fine, thanks.'
    const prevChunk: ChunkResult = {
      text: 'Hello, world! How are you',
      start: 0,
      end: 25
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      3,
      wordSplitter
    )

    // Should overlap the last 3 words: "How are you"
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 3)
    assert.deepStrictEqual(overlapWords, ['How', 'are', 'you'])
  })

  test('handles empty previous chunk', () => {
    const originalText = 'ABCDEFGH'
    const prevChunk: ChunkResult = {
      text: '',
      start: 0,
      end: 0
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      3,
      charSplitter
    )

    assert.strictEqual(
      result,
      0,
      'Should return end position when chunk is empty'
    )
  })

  test('binary search finds exact token boundary', () => {
    const originalText = 'word1 word2 word3 word4 word5'
    const prevChunk: ChunkResult = {
      text: 'word1 word2 word3 word4 word5',
      start: 0,
      end: 29
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      2,
      wordSplitter
    )

    // Should find position that gives exactly 2 words ("word4 word5")
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 2)
    assert.deepStrictEqual(overlapWords, ['word4', 'word5'])
    // May include leading whitespace due to binary search precision
    assert.ok(overlapText.includes('word4 word5'))
  })

  test('handles tokens with varying lengths', () => {
    const originalText = 'I am a developer working on chunking algorithms'
    const prevChunk: ChunkResult = {
      text: 'I am a developer working',
      start: 0,
      end: 24
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      3,
      wordSplitter
    )

    // Should overlap the last 3 words: "a developer working"
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 3)
    assert.deepStrictEqual(overlapWords, ['a', 'developer', 'working'])
  })

  test('handles chunk with only whitespace tokens', () => {
    const originalText = 'word1   word2   word3'
    const prevChunk: ChunkResult = {
      text: 'word1   word2',
      start: 0,
      end: 13
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      1,
      wordSplitter
    )

    // Should overlap the last word
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 1)
    assert.deepStrictEqual(overlapWords, ['word2'])
  })

  test('maintains consistency across different token sizes', () => {
    const originalText = 'a bb ccc dddd eeeee ffffff'
    const prevChunk: ChunkResult = {
      text: 'a bb ccc dddd',
      start: 0,
      end: 13
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      2,
      wordSplitter
    )

    // Should overlap the last 2 words: "ccc dddd"
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 2)
    assert.deepStrictEqual(overlapWords, ['ccc', 'dddd'])
    // May include leading whitespace due to binary search precision
    assert.ok(overlapText.includes('ccc dddd'))
  })

  test('handles overlap at exact word boundaries', () => {
    const originalText = 'first second third fourth fifth'
    const prevChunk: ChunkResult = {
      text: 'first second third',
      start: 0,
      end: 18
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      1,
      wordSplitter
    )

    // Should overlap the last 1 word: "third"
    const overlapText = originalText.slice(result, prevChunk.end)
    const overlapWords = wordSplitter(overlapText)

    assert.strictEqual(overlapWords.length, 1)
    assert.deepStrictEqual(overlapWords, ['third'])
    // May include leading whitespace due to binary search precision
    assert.ok(overlapText.includes('third'))
  })

  test('handles very small overlaps', () => {
    const originalText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const prevChunk: ChunkResult = {
      text: 'ABCDEFGHIJKLMNOP',
      start: 0,
      end: 16
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      1,
      charSplitter
    )

    assert.strictEqual(
      result,
      15,
      'Should return position for 1 character overlap'
    )

    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText, 'P')
    assert.strictEqual(charSplitter(overlapText).length, 1)
  })

  test('stress test with large overlap', () => {
    const originalText = 'A'.repeat(1000) + 'B'.repeat(1000)
    const prevChunk: ChunkResult = {
      text: 'A'.repeat(1000),
      start: 0,
      end: 1000
    }

    const result = calculateOverlapStart(
      originalText,
      prevChunk,
      500,
      charSplitter
    )

    assert.strictEqual(result, 500, 'Should handle large overlaps correctly')

    const overlapText = originalText.slice(result, prevChunk.end)
    assert.strictEqual(overlapText.length, 500)
    assert.strictEqual(charSplitter(overlapText).length, 500)
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
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 16)

    assert.strictEqual(result[1].unit, 'Second paragraph.')
    assert.strictEqual(result[1].start, 18)
    assert.strictEqual(result[1].end, 35)

    assert.strictEqual(result[2].unit, 'Third paragraph.')
    assert.strictEqual(result[2].start, 37)
    assert.strictEqual(result[2].end, 53)
  })

  test('handles multiple consecutive newlines (more than 2)', () => {
    const text = 'First paragraph.\n\n\n\nSecond paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 16)

    assert.strictEqual(result[1].unit, 'Second paragraph.')
    assert.strictEqual(result[1].start, 20)
    assert.strictEqual(result[1].end, 37)
  })

  test('trims whitespace from paragraph units', () => {
    const text =
      '  First paragraph with spaces.  \n\n  Second paragraph with spaces.  '
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph with spaces.')
    assert.strictEqual(result[0].start, 2) // Start after leading whitespace
    assert.strictEqual(result[0].end, 30) // End before trailing whitespace

    assert.strictEqual(result[1].unit, 'Second paragraph with spaces.')
    assert.strictEqual(result[1].start, 36) // Start after leading whitespace (actual implementation)
    assert.strictEqual(result[1].end, 65) // End before trailing whitespace
  })

  test('filters out empty paragraphs', () => {
    const text = 'First paragraph.\n\n\n\nSecond paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[1].unit, 'Second paragraph.')
  })

  test('filters out paragraphs with only whitespace', () => {
    const text = 'First paragraph.\n\n   \t  \n\nSecond paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[1].unit, 'Second paragraph.')
  })

  test('handles empty input', () => {
    const text = ''
    const result = getUnits(text)

    assert.strictEqual(result.length, 0)
  })

  test('handles input with only newlines', () => {
    const text = '\n\n\n\n'
    const result = getUnits(text)

    assert.strictEqual(result.length, 0)
  })

  test('handles input with only whitespace and newlines', () => {
    const text = '  \n\n  \t\n\n  '
    const result = getUnits(text)

    assert.strictEqual(result.length, 0)
  })

  test('handles single newlines (not paragraph separators)', () => {
    const text = 'First line.\nSecond line.\nThird line.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].unit, 'First line.\nSecond line.\nThird line.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 36) // Corrected length
  })

  test('handles mixed single and double newlines', () => {
    const text =
      'First paragraph.\nWith line break.\n\nSecond paragraph.\nAlso with line break.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.\nWith line break.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 33)

    assert.strictEqual(
      result[1].unit,
      'Second paragraph.\nAlso with line break.'
    )
    assert.strictEqual(result[1].start, 35)
    assert.strictEqual(result[1].end, 74)
  })

  test('handles text starting with double newlines', () => {
    const text = '\n\nFirst paragraph.\n\nSecond paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[0].start, 2)
    assert.strictEqual(result[0].end, 18)

    assert.strictEqual(result[1].unit, 'Second paragraph.')
    assert.strictEqual(result[1].start, 20)
    assert.strictEqual(result[1].end, 37)
  })

  test('handles text ending with double newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\n'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'First paragraph.')
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 16)

    assert.strictEqual(result[1].unit, 'Second paragraph.')
    assert.strictEqual(result[1].start, 18)
    assert.strictEqual(result[1].end, 35)
  })

  test('handles very long paragraphs', () => {
    const longParagraph = 'A'.repeat(1000)
    const text = longParagraph + '\n\n' + 'Short paragraph.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, longParagraph)
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 1000)

    assert.strictEqual(result[1].unit, 'Short paragraph.')
    assert.strictEqual(result[1].start, 1002)
    assert.strictEqual(result[1].end, 1018)
  })

  test('handles special characters and unicode', () => {
    const text = 'Paragraph with émojis 🚀🎉.\n\nAnother with símbolos ñ ü.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].unit, 'Paragraph with émojis 🚀🎉.')
    assert.strictEqual(result[1].unit, 'Another with símbolos ñ ü.')

    // Verify character positions are correct for unicode
    const extractedFirst = text.slice(result[0].start, result[0].end)
    const extractedSecond = text.slice(result[1].start, result[1].end)
    assert.strictEqual(extractedFirst, result[0].unit)
    assert.strictEqual(extractedSecond, result[1].unit)
  })

  test('handles tabs and other whitespace characters', () => {
    const text =
      '\tFirst paragraph with tab.\n\n    Second paragraph with spaces.\n\n\tThird with mixed\t whitespace.'
    const result = getUnits(text)

    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].unit, 'First paragraph with tab.')
    assert.strictEqual(result[1].unit, 'Second paragraph with spaces.')
    assert.strictEqual(result[2].unit, 'Third with mixed\t whitespace.')
  })

  test('maintains accurate character positions for complex text', () => {
    const text = '  Para 1.  \n\n  \n\n  Para 2.  \n\n  Para 3.  '
    const result = getUnits(text)

    // Should filter out empty paragraph between Para 1 and Para 2
    assert.strictEqual(result.length, 3)

    // Verify each paragraph can be extracted correctly using its positions
    result.forEach((unit, index) => {
      const extractedText = text.slice(unit.start, unit.end)
      assert.strictEqual(
        extractedText,
        unit.unit,
        `Unit ${index} positions should be accurate`
      )
    })
  })
})

describe('getTrimmedBounds', () => {
  test('handles text with no whitespace', () => {
    const text = 'Hello world'
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello world')
    assert.strictEqual(result?.start, 0)
    assert.strictEqual(result?.end, 11)
  })

  test('trims leading whitespace', () => {
    const text = '   Hello world'
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello world')
    assert.strictEqual(result?.start, 3)
    assert.strictEqual(result?.end, 14)
  })

  test('trims trailing whitespace', () => {
    const text = 'Hello world   '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello world')
    assert.strictEqual(result?.start, 0)
    assert.strictEqual(result?.end, 11)
  })

  test('trims both leading and trailing whitespace', () => {
    const text = '   Hello world   '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello world')
    assert.strictEqual(result?.start, 3)
    assert.strictEqual(result?.end, 14)
  })

  test('handles multiple types of whitespace', () => {
    const text = ' \t\n Hello world \r\n\t '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello world')
    assert.strictEqual(result?.start, 4)
    assert.strictEqual(result?.end, 15)
  })

  test('preserves internal whitespace', () => {
    const text = '  Hello   world  '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello   world')
    assert.strictEqual(result?.start, 2)
    assert.strictEqual(result?.end, 15)
  })

  test('handles text with newlines inside', () => {
    const text = ' \n  First line\nSecond line  \n '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'First line\nSecond line')
    assert.strictEqual(result?.start, 4)
    assert.strictEqual(result?.end, 26)
  })

  test('returns null for empty string', () => {
    const text = ''
    const result = getTrimmedBounds(text)

    assert.strictEqual(result, null)
  })

  test('returns null for whitespace-only string', () => {
    const text = '   \t\n\r   '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result, null)
  })

  test('handles single character', () => {
    const text = 'a'
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'a')
    assert.strictEqual(result?.start, 0)
    assert.strictEqual(result?.end, 1)
  })

  test('handles single character with whitespace', () => {
    const text = '  a  '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'a')
    assert.strictEqual(result?.start, 2)
    assert.strictEqual(result?.end, 3)
  })

  test('handles tabs and various whitespace characters', () => {
    const text = '\t\r\n Hello\tWorld   \t'
    const result = getTrimmedBounds(text)

    // The /\s/ regex matches standard whitespace but not all Unicode whitespace
    assert.strictEqual(result?.unit, 'Hello\tWorld')
    assert.strictEqual(result?.start, 4)
    assert.strictEqual(result?.end, 15)
  })

  test('handles long text with whitespace', () => {
    const longContent = 'A'.repeat(100)
    const text = '    ' + longContent + '    '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, longContent)
    assert.strictEqual(result?.start, 4)
    assert.strictEqual(result?.end, 104)
  })

  test('handles text that is all one whitespace character', () => {
    const text = '     '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result, null)
  })

  test('handles mixed whitespace at boundaries', () => {
    const text = ' \t\n\r Content here \r\n\t '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Content here')
    assert.strictEqual(result?.start, 5)
    assert.strictEqual(result?.end, 17)
  })

  test('position accuracy verification', () => {
    const text = '  \t Hello, world! \n  '
    const result = getTrimmedBounds(text)

    // Verify that extracting from original text using calculated positions gives the same result
    const extracted = text.slice(result!.start, result!.end)
    assert.strictEqual(extracted, result!.unit)
    assert.strictEqual(extracted, 'Hello, world!')
  })

  test('handles unicode characters and whitespace', () => {
    const text = '  Hello 世界 🌍  '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Hello 世界 🌍')
    assert.strictEqual(result?.start, 2)
    assert.strictEqual(result?.end, 13)

    // Verify position accuracy with unicode
    const extracted = text.slice(result!.start, result!.end)
    assert.strictEqual(extracted, result!.unit)
  })

  test('handles text with only leading whitespace', () => {
    const text = '    Content'
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Content')
    assert.strictEqual(result?.start, 4)
    assert.strictEqual(result?.end, 11)
  })

  test('handles text with only trailing whitespace', () => {
    const text = 'Content    '
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, 'Content')
    assert.strictEqual(result?.start, 0)
    assert.strictEqual(result?.end, 7)
  })

  test('stress test with very long whitespace padding', () => {
    const padding = ' '.repeat(1000)
    const content = 'Middle content'
    const text = padding + content + padding
    const result = getTrimmedBounds(text)

    assert.strictEqual(result?.unit, content)
    assert.strictEqual(result?.start, 1000)
    assert.strictEqual(result?.end, 1014)

    // Verify extraction accuracy
    const extracted = text.slice(result!.start, result!.end)
    assert.strictEqual(extracted, content)
  })
})
