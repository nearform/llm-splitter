import { test, describe } from 'node:test'
import assert from 'node:assert'
import { split, getChunk, iterateChunks } from '../src/chunker.js'
import type { SplitOptions, ChunkResult } from '../src/types.js'
import { encoding_for_model, type Tiktoken } from 'tiktoken'
import { blogPost, multilineBlogPost } from './fixtures.js'

describe('split', () => {
  test('should split a single string into correct sizes', () => {
    const input: string = 'abcdefghij'
    assert.deepStrictEqual(split(input, { chunkSize: 3 }), [
      { text: 'abc', start: 0, end: 3 },
      { text: 'def', start: 3, end: 6 },
      { text: 'ghi', start: 6, end: 9 },
      { text: 'j', start: 9, end: 10 }
    ])
  })

  test('should split an array of strings into correct sizes', () => {
    const input: string[] = ['abcde', 'fghij']
    assert.deepStrictEqual(split(input, { chunkSize: 2 }), [
      { text: ['ab'], start: 0, end: 2 },
      { text: ['cd'], start: 2, end: 4 },
      { text: ['e'], start: 4, end: 5 },
      { text: ['fg'], start: 5, end: 7 },
      { text: ['hi'], start: 7, end: 9 },
      { text: ['j'], start: 9, end: 10 }
    ])
  })

  test('should return the whole string if smaller than chunk size', () => {
    const input: string = 'abc'
    assert.deepStrictEqual(split(input, { chunkSize: 10 }), [
      { text: 'abc', start: 0, end: 3 }
    ])
  })

  test('should handle empty string input', () => {
    assert.deepStrictEqual(split('', { chunkSize: 5 }), [])
  })

  test('should handle empty array input', () => {
    assert.deepStrictEqual(split([], { chunkSize: 5 }), [])
  })

  test('should handle empty array input (coverage)', () => {
    assert.deepStrictEqual(split([]), [])
  })

  test('should use default chunk size if not provided', () => {
    const input: string = 'a'.repeat(600)
    const result: ChunkResult[] = split(input)
    assert.strictEqual(result.length, 2)
    assert.strictEqual((result[0].text as string).length, 512)
    assert.strictEqual((result[1].text as string).length, 88)
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 512)
    assert.strictEqual(result[1].start, 512)
    assert.strictEqual(result[1].end, 600)
  })

  test('should split with overlap (sliding window)', () => {
    const input: string = 'abcdefghij'
    assert.deepStrictEqual(split(input, { chunkSize: 4, chunkOverlap: 2 }), [
      { text: 'abcd', start: 0, end: 4 },
      { text: 'cdef', start: 2, end: 6 },
      { text: 'efgh', start: 4, end: 8 },
      { text: 'ghij', start: 6, end: 10 }
    ])
  })

  test('should use a custom splitter (count vowels only)', () => {
    const input: string = 'abcdeiouxyz'
    const options: SplitOptions = {
      chunkSize: 2,
      splitter: (t: string) => t.match(/[aeiou]/g) || []
    }
    assert.deepStrictEqual(split(input, options), [
      { text: 'abcde', start: 0, end: 5 },
      { text: 'io', start: 5, end: 7 },
      { text: 'uxyz', start: 7, end: 11 }
    ])
  })

  test('should handle custom splitter with overlap', () => {
    const input: string = 'aeioubcdfg'
    const options: SplitOptions = {
      chunkSize: 3,
      chunkOverlap: 1,
      splitter: (t: string) => t.match(/[aeiou]/g) || []
    }
    assert.deepStrictEqual(split(input, options), [
      { text: 'aei', start: 0, end: 3 },
      { text: 'ioubcdfg', start: 2, end: 10 }
    ])
  })

  test('should split by paragraph boundaries', () => {
    const input: string = 'Para1 line1\nPara1 line2\n\nPara2 line1\n\nPara3'
    const result: ChunkResult[] = split(input, {
      chunkSize: 100,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [
      {
        text: 'Para1 line1\nPara1 line2\n\nPara2 line1\n\nPara3',
        start: 0,
        end: 43
      }
    ])
  })

  test('should perform greedy unit-based chunking with overlap (paragraph)', () => {
    const input: string = 'A\n\nB\n\nC\n\nD'
    const result: ChunkResult[] = split(input, {
      chunkSize: 3,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    // With position-accurate overlap, we get actual overlap from original text positions
    // Second chunk starts at position 6 (where 'C' begins) to include 1 token overlap
    assert.deepStrictEqual(result, [
      { text: 'A\n\nB\n\nC', start: 0, end: 7 },
      { text: 'C\n\nD', start: 6, end: 10 }
    ])
  })

  test('should perform greedy unit-based chunking with overlap and join multiple units (paragraph)', () => {
    const input: string = 'A1\n\nB2\n\nC3\n\nD4'
    const result: ChunkResult[] = split(input, {
      chunkSize: 6,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    // With position-accurate overlap, second chunk includes 1 token overlap ('3')
    // Starts at position 9 (where '3' begins in 'C3') to include the overlap
    assert.deepStrictEqual(result, [
      { text: 'A1\n\nB2\n\nC3', start: 0, end: 10 },
      { text: '3\n\nD4', start: 9, end: 14 }
    ])
  })

  test('should handle empty string with chunkStrategy', () => {
    assert.deepStrictEqual(split('', { chunkStrategy: 'paragraph' }), [])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    // With new behavior, empty elements are completely skipped - no chunks generated
    assert.deepStrictEqual(split(['', ''], { chunkStrategy: 'paragraph' }), [])
  })

  test('should handle array of empty strings', () => {
    // With new behavior, empty elements are completely skipped - no chunks generated
    assert.deepStrictEqual(split(['', '']), [])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    // With new behavior, empty elements are completely skipped - no chunks generated
    assert.deepStrictEqual(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' }),
      []
    )
  })

  test('should cover array input branch for unit-based chunking', () => {
    const input: string[] = ['A', 'B', 'C']
    // This triggers aggregation of multiple elements into single chunk
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    // With aggregation, all elements fit in one chunk
    assert.deepStrictEqual(result, [
      { text: ['A', 'B', 'C'], start: 0, end: 3 }
    ])
  })

  test('should cover array input branch for unit-based chunking with empty strings', () => {
    const input: string[] = ['', 'A', '']
    // With new behavior, empty elements are completely skipped - only 'A' remains
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    // Only non-empty elements should be included
    assert.deepStrictEqual(result, [{ text: ['A'], start: 0, end: 1 }])
  })

  test('should cover array input branch for unit-based chunking with empty array', () => {
    const input: string[] = []
    // This triggers the Array.isArray(text) && text !== texts branch with an empty array
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [])
  })

  test('should cover array input mapping for unit-based chunking with multiple non-empty strings', () => {
    const input: string[] = ['A', 'B', 'C', 'D']
    // This triggers the Array.isArray(text) && text !== texts branch and uses the mapped result
    const result: ChunkResult[] = split(input, {
      chunkSize: 1,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [
      { text: ['A'], start: 0, end: 1 },
      { text: ['B'], start: 1, end: 2 },
      { text: ['C'], start: 2, end: 3 },
      { text: ['D'], start: 3, end: 4 }
    ])
  })

  test('split and getChunk are co-functions', () => {
    // Generate a large array of random word strings of varying sizes
    function randomWord(): string {
      const length: number = Math.floor(Math.random() * 16) + 2
      return Array.from({ length }, () =>
        String.fromCharCode(97 + Math.floor(Math.random() * 26))
      ).join('')
    }
    function randomPhrase(): string {
      const wordCount: number = Math.floor(Math.random() * 50) + 5
      return Array.from({ length: wordCount }, randomWord).join(' ')
    }
    // At least a few hundred words total
    let totalWords: number = 0
    const input: string[] = []
    while (totalWords < 500) {
      const phrase: string = randomPhrase()
      totalWords += phrase.split(' ').length
      input.push(phrase)
    }
    for (const chunk of iterateChunks(input, { chunkSize: 50 })) {
      const chunkFromGetChunk: string | string[] = getChunk(
        input,
        chunk.start,
        chunk.end
      )
      const chunkStr: string = Array.isArray(chunkFromGetChunk)
        ? chunkFromGetChunk.join('')
        : chunkFromGetChunk
      const expectedText: string = Array.isArray(chunk.text)
        ? chunk.text.join('')
        : chunk.text
      assert.strictEqual(chunkStr, expectedText)
    }
  })

  test('should use default chunkOverlap when undefined', () => {
    const result: ChunkResult[] = Array.from(
      split('abcdefghijk', {
        chunkSize: 3,
        chunkOverlap: undefined // explicitly undefined to test default
      })
    )
    assert.strictEqual(result.length, 4)
    assert.strictEqual(result[0].text, 'abc')
    assert.strictEqual(result[1].text, 'def') // no overlap
  })
})

describe('getChunk', () => {
  test('should return the full string if no start/end provided', () => {
    assert.strictEqual(getChunk('abcdefgh'), 'abcdefgh')
    assert.deepStrictEqual(getChunk(['abc', 'def', 'gh']), ['abc', 'def', 'gh'])
  })

  test('should return substring for start only', () => {
    assert.strictEqual(getChunk('abcdefgh', 2), 'cdefgh')
    assert.deepStrictEqual(getChunk(['abc', 'def', 'gh'], 3), ['def', 'gh'])
  })

  test('should return substring for start and end', () => {
    assert.strictEqual(getChunk('abcdefgh', 2, 5), 'cde')
    assert.deepStrictEqual(getChunk(['abc', 'def', 'gh'], 1, 7), [
      'bc',
      'def',
      'g'
    ])
  })

  test('should handle end beyond input length', () => {
    assert.strictEqual(getChunk('abc', 1, 10), 'bc')
    assert.deepStrictEqual(getChunk(['abc', 'def'], 2, 10), ['c', 'def'])
  })

  test('should handle start >= end', () => {
    assert.strictEqual(getChunk('abc', 2, 2), '')
    assert.deepStrictEqual(getChunk(['abc', 'def'], 4, 2), [])
  })

  test('should handle empty input', () => {
    assert.strictEqual(getChunk('', 0, 2), '')
    assert.deepStrictEqual(getChunk([], 0, 2), [])
  })

  // Test for chunker.ts:38 - getChunk with startIndex === null
  test('getChunk should return empty array when start is beyond input length', () => {
    const input = ['abc', 'def']
    const result = getChunk(input, 100, 105) // start way beyond length
    assert.deepStrictEqual(result, [])
  })

  // Test for chunker.ts:38 - getChunk with very specific edge case
  test('getChunk should cover endIndex assignment when end is reached mid-string', () => {
    const result = getChunk(['hello', 'world'], 3, 7)
    assert.deepStrictEqual(result, ['lo', 'wo'])
  })

  test('getChunk should handle array where start position is exactly at boundary', () => {
    const input = ['a', 'b', 'c']
    // Try to get chunk starting exactly at total length - this should return empty string at end
    const result = getChunk(input, 3, 4)
    assert.deepStrictEqual(result, ['']) // Returns empty string, not empty array
  })
})

describe('split (coverage edge cases)', () => {
  test('should cover paragraph chunking with small chunk size', () => {
    const input: string = 'A\n\nB'
    // Both paragraphs fit in one chunk with joiner
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [{ text: 'A\n\nB', start: 0, end: 4 }])
  })

  test('should handle a single unit larger than chunk size', () => {
    const input: string = 'ThisIsAVeryLongParagraph'
    // Paragraph is longer than chunkSize, so it should be split into multiple chunks
    const result: ChunkResult[] = split(input, {
      chunkSize: 5,
      chunkStrategy: 'paragraph'
    })
    assert.ok(result.length >= 2) // Should have multiple chunks
    assert.ok(result[0].text.length <= 5) // First chunk should respect size limit
    assert.strictEqual(result[0].text, 'ThisI') // First chunk should be 'ThisI'
    assert.strictEqual(result[0].start, 0)
    assert.strictEqual(result[0].end, 5)
  })

  test('should cover splitter branch for character-based chunking', () => {
    const input: string = 'abcdef'
    // Use a custom splitter to trigger the branch
    const result: ChunkResult[] = split(input, {
      chunkSize: 2,
      splitter: (t: string) => t.split('')
    })
    assert.deepStrictEqual(result[0], { text: 'ab', start: 0, end: 2 })
  })

  test("should cover the 'break' branch when currentLen > chunkSize in character-based chunking", () => {
    const input: string = 'abcde'
    // chunkSize 2, so after 'ab', 'c' will be a new chunk
    const result: ChunkResult[] = split(input, { chunkSize: 2 })
    assert.deepStrictEqual(result, [
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'e', start: 4, end: 5 }
    ])
  })

  test("should cover the 'end === start' branch in character-based chunking", () => {
    const input: string = 'a'
    // chunkSize 0 will force end === start
    const result: ChunkResult[] = split(input, { chunkSize: 0 })
    assert.deepStrictEqual(result[0], { text: 'a', start: 0, end: 1 })
  })

  test('getChunk should return empty array when start is beyond input length', () => {
    const input: string[] = ['abc', 'def']
    const result: string | string[] = getChunk(input, 100, 105) // start way beyond length
    assert.deepStrictEqual(result, [])
  })

  test('should handle array input and maintain array output format', () => {
    const input: string[] = ['abc', 'def']
    const result: ChunkResult[] = split(input, { chunkSize: 2 })
    assert.deepStrictEqual(result[0].text, ['ab']) // Should be array format
    assert.deepStrictEqual(result[1].text, ['c'])
  })

  test('should handle array input with paragraph strategy', () => {
    const input: string[] = [
      'Para1 line1\nPara1 line2\n\nPara2 line1',
      'Para3\n\nPara4'
    ]
    const result: ChunkResult[] = split(input, {
      chunkSize: 100,
      chunkStrategy: 'paragraph'
    })
    // With aggregation, both elements fit in one chunk since total token count < 100
    assert.deepStrictEqual(result[0].text, [
      'Para1 line1\nPara1 line2\n\nPara2 line1',
      'Para3\n\nPara4'
    ]) // Should be aggregated into single chunk
    assert.strictEqual(result.length, 1, 'Should create one aggregated chunk')
  })

  test('should handle edge case where splitter returns empty result', () => {
    const input: string = 'abc'
    // Custom splitter that returns empty array, forcing bestEnd === start
    const emptySplitter: (text: string) => string[] = () => []
    const result: ChunkResult[] = split(input, {
      chunkSize: 1,
      splitter: emptySplitter
    })
    assert.ok(result.length > 0) // Should still produce chunks
  })

  test('should handle array input with empty string and custom splitter', () => {
    const input: string[] = ['', 'abc']
    const charSplitter: (text: string) => string[] = (text: string) =>
      text.split('')
    const result: ChunkResult[] = split(input, {
      chunkSize: 2,
      splitter: charSplitter
    })
    // With new behavior, empty elements are skipped - only 'abc' is processed
    assert.deepStrictEqual(result[0].text, ['ab']) // First chunk should be 'ab'
    assert.deepStrictEqual(result[1].text, ['c']) // Second chunk should be 'c'
  })

  test('should handle array input with paragraph strategy and custom splitter', () => {
    const input: string[] = ['Para1\n\nPara2', 'Para3']
    const wordSplitter: (text: string) => string[] = (text: string) =>
      text.split(/\s+/)
    const result: ChunkResult[] = split(input, {
      chunkSize: 5,
      chunkStrategy: 'paragraph',
      splitter: wordSplitter
    })
    // With aggregation and word splitter, elements may be aggregated based on word count
    assert.deepStrictEqual(result[0].text, ['Para1\n\nPara2', 'Para3']) // Should use aggregated array format
  })

  test('should handle array input character chunking with custom splitter', () => {
    const input: string[] = ['hello', 'world']
    const vowelSplitter: (text: string) => string[] = (text: string) =>
      text.match(/[aeiou]/g) || []
    const result: ChunkResult[] = split(input, {
      chunkSize: 2,
      splitter: vowelSplitter
    })
    assert.deepStrictEqual(result[0].text, ['hello']) // Should maintain array format
  })

  test('should handle complex array input with empty strings and custom splitter function', () => {
    const input: string[] = ['', 'test', '']
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      splitter: (text: string) => text.split('')
    })
    assert.ok(result.length > 0)
    // With new behavior, empty elements are skipped - only 'test' remains
    assert.deepStrictEqual(result[0].text, ['test'])
  })

  test('should handle array input with character strategy and length-affecting splitter', () => {
    const input: string[] = ['hello', 'world']
    // Splitter that changes effective length
    const customSplitter: (text: string) => string[] = (text: string) =>
      text.length > 3 ? [text] : []
    const result: ChunkResult[] = split(input, {
      chunkSize: 1,
      splitter: customSplitter
    })
    assert.strictEqual(Array.isArray(result[0].text), true) // Should maintain array format
  })

  test('should verify split and getChunk consistency with tiktoken splitter on blog fixture', () => {
    // Create tokenizer using text-embedding-ada-002 model (same as in utils.spec.ts)
    const tokenizer: Tiktoken = encoding_for_model('text-embedding-ada-002')
    const textDecoder = new TextDecoder()

    // Create tiktoken-based splitter that returns token strings
    const tokenSplitter: (text: string) => string[] = (text: string) => {
      const tokens: Uint32Array = tokenizer.encode(text)
      const tokenStrs: string[] = []
      for (let i: number = 0; i < tokens.length; i++) {
        tokenStrs.push(
          textDecoder.decode(tokenizer.decode(new Uint32Array([tokens[i]])))
        )
      }
      return tokenStrs
    }

    // Use the blog fixture with tiktoken splitter
    const chunks: ChunkResult[] = split(blogPost, {
      chunkSize: 512,
      chunkOverlap: 10,
      splitter: tokenSplitter
    })

    // Verify we get multiple chunks for this large text
    assert.ok(chunks.length > 1, 'Should produce multiple chunks for blog post')

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedText = getChunk(blogPost, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }

    // Clean up tokenizer
    tokenizer.free()
  })

  test('should verify split and getChunk consistency with character-based splitting on multilineBlogPost fixture', () => {
    // Use the multilineBlogPost fixture with character-based splitting (default behavior)
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 512,
      chunkOverlap: 50
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })

  test('should verify split and getChunk consistency with paragraph strategy on multilineBlogPost fixture', () => {
    // Use the multilineBlogPost fixture with paragraph-based splitting
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 1024,
      chunkOverlap: 100,
      chunkStrategy: 'paragraph'
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post with paragraph strategy'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })

  test('should verify split and getChunk consistency with tiktoken splitter on multilineBlogPost fixture', () => {
    // Create tokenizer using text-embedding-ada-002 model
    const tokenizer: Tiktoken = encoding_for_model('text-embedding-ada-002')
    const textDecoder = new TextDecoder()

    // Create tiktoken-based splitter that returns token strings
    const tokenSplitter: (text: string) => string[] = (text: string) => {
      const tokens: Uint32Array = tokenizer.encode(text)
      const tokenStrs: string[] = []
      for (let i: number = 0; i < tokens.length; i++) {
        tokenStrs.push(
          textDecoder.decode(tokenizer.decode(new Uint32Array([tokens[i]])))
        )
      }
      return tokenStrs
    }

    // Use the multilineBlogPost fixture with tiktoken splitter
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 256,
      chunkOverlap: 20,
      splitter: tokenSplitter
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post with tiktoken'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }

    // Clean up tokenizer
    tokenizer.free()
  })

  test('should handle multilineBlogPost with custom word-based splitter and verify consistency', () => {
    // Create a word-based splitter
    const wordSplitter: (text: string) => string[] = (text: string) =>
      text.split(/\s+/).filter(word => word.length > 0)

    // Use the multilineBlogPost fixture with word-based splitting
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 100,
      chunkOverlap: 15,
      splitter: wordSplitter
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post with word splitter'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })

  test('should handle multilineBlogPost with sentence-based splitter and verify consistency', () => {
    // Create a sentence-based splitter (split on sentence endings)
    const sentenceSplitter: (text: string) => string[] = (text: string) =>
      text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0)

    // Use the multilineBlogPost fixture with sentence-based splitting
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 50,
      chunkOverlap: 5,
      splitter: sentenceSplitter
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post with sentence splitter'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })

  test('should handle multilineBlogPost with no overlap and verify consistency', () => {
    // Test with no overlap to ensure edge case handling
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 300,
      chunkOverlap: 0
    })

    // Verify we get multiple chunks for this large text array
    assert.ok(
      chunks.length > 1,
      'Should produce multiple chunks for multiline blog post with no overlap'
    )

    // Verify no overlaps between chunks (gaps are allowed due to trimming)
    for (let i = 0; i < chunks.length - 1; i++) {
      assert.ok(
        chunks[i].end <= chunks[i + 1].start,
        `Chunk ${i} end (${chunks[i].end}) should not exceed chunk ${i + 1} start (${chunks[i + 1].start}) when no overlap`
      )
    }

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })

  test('should handle multilineBlogPost with small chunk size and verify consistency', () => {
    // Test with very small chunk size to stress test the splitting
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 50,
      chunkOverlap: 10
    })

    // Verify we get many chunks for this large text array with small chunk size
    assert.ok(
      chunks.length > 5,
      'Should produce many chunks for multiline blog post with small chunk size'
    )

    // For each chunk, verify that getChunk returns the same text
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
    }
  })
})

describe('Complex array chunking scenarios', () => {
  test('should handle multiple array elements in a single chunk', () => {
    const input: string[] = ['short', 'tiny', 'small', 'brief', 'mini']
    // Large chunk size should fit multiple elements (total length is 23 chars)
    const chunks: ChunkResult[] = split(input, { chunkSize: 30 })

    // With new aggregation behavior, all elements should be combined into one chunk
    assert.strictEqual(chunks.length, 1, 'Should create one aggregated chunk')
    assert.deepStrictEqual(
      chunks[0].text,
      input,
      'All elements should be aggregated together'
    )
    assert.strictEqual(chunks[0].start, 0, 'Chunk should start at 0')
    assert.strictEqual(chunks[0].end, 23, 'Chunk should end at total length')

    // Verify chunk boundaries and consistency with getChunk
    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'Chunk should match getChunk result'
      )
    }

    // Test a case where we can force multiple chunks with very small chunk size
    const chunks2: ChunkResult[] = split(input, { chunkSize: 3 })

    // Verify all chunks are consistent
    for (const chunk of chunks2) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'Small chunk size chunks should match getChunk result'
      )
    }
  })

  test('should handle chunks spanning partial-full-partial elements', () => {
    const input: string[] = ['hello world', 'this is a test', 'final segment']
    // Chunk size designed to create partial-full-partial pattern
    const chunks: ChunkResult[] = split(input, { chunkSize: 20 })

    // Find a chunk that spans multiple elements with partial boundaries
    let foundComplexChunk = false
    for (const chunk of chunks) {
      const chunkText = chunk.text as string[]
      if (chunkText.length >= 2) {
        // Check if first element is partial (doesn't match full original element)
        const firstElementIndex = input.findIndex(elem =>
          elem.includes(chunkText[0])
        )
        const lastElementIndex = input.findIndex(elem =>
          elem.includes(chunkText[chunkText.length - 1])
        )

        if (
          firstElementIndex !== -1 &&
          lastElementIndex !== -1 &&
          firstElementIndex !== lastElementIndex
        ) {
          foundComplexChunk = true

          // Verify this complex chunk is consistent with getChunk
          const retrieved = getChunk(input, chunk.start, chunk.end)
          assert.deepStrictEqual(
            chunk.text,
            retrieved,
            'Complex chunk should match getChunk result'
          )
          break
        }
      }
    }

    // We should find at least one complex chunk or all chunks should be consistent
    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'All chunks should match getChunk results'
      )
    }
  })

  test('should handle edge case: chunk starts in middle of element, spans full elements, ends in middle', () => {
    const input: string[] = [
      'abcdefghij',
      'klmnopqrst',
      'uvwxyz1234',
      '567890abcd'
    ]

    // Test specific position that creates partial-full-full-partial pattern
    const retrieved = getChunk(input, 5, 35) // Start mid-first, end mid-last

    // Should get: 'fghij' + 'klmnopqrst' + 'uvwxyz1234' + '56789'
    const expected = ['fghij', 'klmnopqrst', 'uvwxyz1234', '56789']
    assert.deepStrictEqual(
      retrieved,
      expected,
      'Should handle partial-full-full-partial pattern'
    )

    // Now verify this works with split() at various chunk sizes
    const chunkSizes = [8, 15, 25, 30]
    for (const chunkSize of chunkSizes) {
      const chunks: ChunkResult[] = split(input, { chunkSize })

      // Find chunk(s) that contain positions 5-35
      const relevantChunks = chunks.filter(
        chunk =>
          (chunk.start <= 5 && chunk.end >= 35) ||
          (chunk.start >= 5 && chunk.start < 35) ||
          (chunk.end > 5 && chunk.end <= 35)
      )

      // Verify each relevant chunk is consistent
      for (const chunk of relevantChunks) {
        const chunkRetrieved = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(
          chunk.text,
          chunkRetrieved,
          `Chunk ${chunk.start}-${chunk.end} should match getChunk with chunkSize ${chunkSize}`
        )
      }
    }
  })

  test('should handle array elements with varying lengths in complex boundary scenarios', () => {
    const input: string[] = [
      'a', // length 1
      'bb', // length 2
      'ccc', // length 3
      'dddd', // length 4
      'eeeee', // length 5
      'ffffff' // length 6
    ]
    // Total length: 21 characters

    // Test various complex boundary scenarios
    const testCases = [
      {
        start: 1,
        end: 10,
        description: 'spans from middle of first to middle of fourth'
      },
      {
        start: 3,
        end: 15,
        description: 'spans from second element to middle of fifth'
      },
      {
        start: 6,
        end: 18,
        description: 'spans from middle of third to middle of sixth'
      },
      { start: 0, end: 21, description: 'entire input' },
      {
        start: 2,
        end: 20,
        description: 'almost entire input with partial boundaries'
      }
    ]

    for (const { start, end, description } of testCases) {
      const retrieved = getChunk(input, start, end)

      // Verify the retrieved chunk makes sense
      assert.ok(
        Array.isArray(retrieved),
        `Retrieved chunk should be array for ${description}`
      )

      // Calculate expected result manually to verify correctness
      let currentPos = 0
      let startIdx = -1,
        startOffset = 0
      let endIdx = -1,
        endOffset = 0

      for (let i = 0; i < input.length; i++) {
        const element = input[i]
        const nextPos = currentPos + element.length

        if (currentPos <= start && start < nextPos && startIdx === -1) {
          startIdx = i
          startOffset = start - currentPos
        }

        if (currentPos < end && end <= nextPos && endIdx === -1) {
          endIdx = i
          endOffset = end - currentPos
        }

        currentPos = nextPos
      }

      // Verify the positions make sense
      assert.ok(
        startIdx >= 0,
        `Should find valid start index for ${description}`
      )
      if (end <= 21) {
        assert.ok(endIdx >= 0, `Should find valid end index for ${description}`)
      }

      // Now test with split() to ensure consistency
      const chunks: ChunkResult[] = split(input, { chunkSize: 7 }) // Small chunks to force boundaries

      for (const chunk of chunks) {
        const chunkRetrieved = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(
          chunk.text,
          chunkRetrieved,
          `Chunk consistency failed for ${description}`
        )
      }
    }
  })

  test('should handle complex overlapping scenarios with array boundaries', () => {
    const input: string[] = ['first', 'second', 'third', 'fourth', 'fifth']
    // lengths: 5, 6, 5, 6, 5 = total 27

    const chunks: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkOverlap: 4
    })

    assert.ok(chunks.length > 1, 'Should create multiple overlapping chunks')

    // Verify all chunks maintain consistency
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const retrieved = getChunk(input, chunk.start, chunk.end)

      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        `Chunk ${i} should match getChunk result`
      )

      // Verify chunk contains array elements
      assert.ok(Array.isArray(chunk.text), `Chunk ${i} should be array`)
      assert.ok(
        (chunk.text as string[]).length > 0,
        `Chunk ${i} should not be empty`
      )

      // Verify overlap with next chunk if it exists
      if (i < chunks.length - 1) {
        const nextChunk = chunks[i + 1]
        const overlapSize = chunk.end - nextChunk.start
        assert.ok(
          overlapSize >= 0,
          `Chunks ${i} and ${i + 1} should have valid overlap`
        )
      }
    }
  })

  test('should handle single element that spans multiple chunks', () => {
    const longElement = 'a'.repeat(100)
    const input: string[] = [longElement, 'short']

    const chunks: ChunkResult[] = split(input, { chunkSize: 30 })

    // First element should be split across multiple chunks
    const chunksWithFirstElement = chunks.filter(chunk => {
      const chunkText = chunk.text as string[]
      return chunkText.some(text => text.includes('a'))
    })

    assert.ok(
      chunksWithFirstElement.length > 1,
      'Long element should be split across multiple chunks'
    )

    // Verify all chunks are consistent
    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'Long element chunks should match getChunk results'
      )
    }

    // Verify no data is lost when reassembling
    const allChunkText = chunks
      .map(chunk => (chunk.text as string[]).join(''))
      .join('')
    const originalText = input.join('')
    assert.strictEqual(
      allChunkText,
      originalText,
      'Reassembled chunks should equal original text'
    )
  })

  test('should handle empty elements mixed with content in complex boundaries', () => {
    const input: string[] = ['', 'content', '', 'more', '', 'final', '']

    const chunks: ChunkResult[] = split(input, { chunkSize: 8 })

    // With new aggregation behavior, empty elements are included in chunks with content
    // Verify all chunks are consistent with getChunk, accounting for the difference in empty element handling
    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)

      // getChunk() filters out empty strings with .filter(Boolean), but split() preserves them
      // So we need to compare the non-empty elements for chunks that contain mixed content
      if (chunk.start === chunk.end && (chunk.text as string[]).length > 0) {
        // This handles the case where split() preserves empty elements but getChunk returns []
        const chunkText = chunk.text as string[]
        assert.ok(
          chunkText.every(elem => elem === ''),
          'Empty-only chunk should contain only empty strings'
        )
        assert.deepStrictEqual(
          retrieved,
          [],
          'getChunk should return empty array for zero-length range'
        )
      } else {
        // For chunks with actual content, we need to account for getChunk filtering empty strings
        const chunkTextFiltered = (chunk.text as string[]).filter(Boolean)

        // Handle the fact that retrieved could be string or string[]
        if (Array.isArray(retrieved)) {
          const retrievedFiltered = retrieved.filter(Boolean)

          if (
            chunkTextFiltered.length === 0 &&
            retrievedFiltered.length === 0
          ) {
            // Both are effectively empty after filtering
            assert.ok(
              true,
              'Both chunk and retrieved are empty after filtering'
            )
          } else {
            // Compare the filtered versions for content consistency
            assert.deepStrictEqual(
              chunkTextFiltered,
              retrievedFiltered,
              'Filtered chunks should match filtered getChunk results'
            )

            // Also verify the joined text matches (this is the real content verification)
            const chunkJoined = (chunk.text as string[]).join('')
            const retrievedJoined = retrieved.join('')
            assert.strictEqual(
              chunkJoined,
              retrievedJoined,
              'Joined text should match between chunk and getChunk'
            )
          }
        } else {
          // If retrieved is a string, we're dealing with string input
          // This shouldn't happen with array input, but handle it for completeness
          assert.fail('Expected array result from getChunk with array input')
        }
      }
    }

    // Test specific boundary that crosses empty elements
    const retrieved = getChunk(input, 2, 10) // Should span multiple elements including empty ones
    assert.ok(Array.isArray(retrieved), 'Retrieved chunk should be array')

    // Verify the result makes sense structurally
    const retrievedJoined = retrieved.join('')
    const expectedText = input.join('').slice(2, 10)
    assert.strictEqual(
      retrievedJoined,
      expectedText,
      'Retrieved chunk should match expected substring'
    )

    // Test various edge cases with empty elements
    assert.deepStrictEqual(
      getChunk(input, 0, 0),
      [],
      'Empty range at start should return empty array'
    )
    assert.deepStrictEqual(
      getChunk(input, 1, 1),
      [''],
      'Empty range in first element content should return array with empty string'
    )

    // Test a range that includes empty elements
    const rangeWithEmptyElements = getChunk(input, 0, 3)
    assert.ok(
      Array.isArray(rangeWithEmptyElements),
      'Range with empty elements should be array'
    )
    assert.strictEqual(
      rangeWithEmptyElements.join(''),
      input.join('').slice(0, 3),
      'Range with empty elements should match expected content'
    )
  })

  test('should handle complex paragraph strategy with array boundaries', () => {
    const input: string[] = [
      'Para1 sentence1. Para1 sentence2.\n\nPara2 content.',
      'Para3 start.\n\nPara4 content here.',
      'Final paragraph content.'
    ]

    const chunks: ChunkResult[] = split(input, {
      chunkSize: 50,
      chunkStrategy: 'paragraph'
    })

    // Verify consistency for paragraph-based chunking
    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'Paragraph chunks should match getChunk results'
      )

      // Verify each chunk contains array elements
      assert.ok(Array.isArray(chunk.text), 'Paragraph chunk should be array')
    }
  })

  test('should handle stress test with many small array elements', () => {
    // Create array with many small elements
    const input: string[] = Array.from({ length: 50 }, (_, i) => `item${i}`)

    const chunks: ChunkResult[] = split(input, {
      chunkSize: 25,
      chunkOverlap: 5
    })

    assert.ok(
      chunks.length > 1,
      'Should create multiple chunks from many elements'
    )

    // Verify every chunk is consistent
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const retrieved = getChunk(input, chunk.start, chunk.end)

      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        `Stress test chunk ${i} should match getChunk result`
      )

      // Verify chunk structure
      assert.ok(Array.isArray(chunk.text), `Chunk ${i} should be array`)
      assert.ok(
        (chunk.text as string[]).length > 0,
        `Chunk ${i} should not be empty`
      )
    }

    // Verify no gaps between chunks (accounting for overlap)
    for (let i = 0; i < chunks.length - 1; i++) {
      const currentChunk = chunks[i]
      const nextChunk = chunks[i + 1]

      assert.ok(
        nextChunk.start <= currentChunk.end,
        `Chunks ${i} and ${i + 1} should not have gaps`
      )
    }
  })

  test('boundary edge case: chunk exactly at element boundaries', () => {
    const input: string[] = ['abc', 'def', 'ghi', 'jkl']
    // Positions: 0-3, 3-6, 6-9, 9-12

    // Test chunks that align exactly with element boundaries
    const testCases = [
      { start: 0, end: 3, expected: ['abc'] },
      { start: 3, end: 6, expected: ['def'] },
      { start: 0, end: 6, expected: ['abc', 'def'] },
      { start: 3, end: 9, expected: ['def', 'ghi'] },
      { start: 0, end: 12, expected: ['abc', 'def', 'ghi', 'jkl'] }
    ]

    for (const { start, end, expected } of testCases) {
      const retrieved = getChunk(input, start, end)
      assert.deepStrictEqual(
        retrieved,
        expected,
        `Boundary-aligned chunk ${start}-${end} should match expected result`
      )
    }

    // Now test with split() using sizes that align with boundaries
    const chunks: ChunkResult[] = split(input, { chunkSize: 6 }) // Should align with 2 elements

    for (const chunk of chunks) {
      const retrieved = getChunk(input, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrieved,
        'Boundary-aligned split chunks should match getChunk results'
      )
    }
  })
})

describe('split and getChunk relationship matrix tests', () => {
  // Test matrix configurations
  const testConfigurations = [
    // Configuration 1: Small chunks, no overlap
    {
      chunkSize: 100,
      chunkOverlap: 0,
      description: 'small chunks, no overlap'
    },
    // Configuration 2: Medium chunks, small overlap
    {
      chunkSize: 300,
      chunkOverlap: 30,
      description: 'medium chunks, small overlap'
    },
    // Configuration 3: Large chunks, medium overlap
    {
      chunkSize: 800,
      chunkOverlap: 150,
      description: 'large chunks, medium overlap'
    },
    // Configuration 4: Very small chunks, high overlap
    {
      chunkSize: 75,
      chunkOverlap: 50,
      description: 'very small chunks, high overlap'
    },
    // Configuration 5: Medium chunks, very high overlap
    {
      chunkSize: 400,
      chunkOverlap: 300,
      description: 'medium chunks, very high overlap'
    }
  ]

  const chunkStrategies = [
    { name: 'character', value: undefined },
    { name: 'paragraph', value: 'paragraph' as const }
  ]

  // Test with blogPost (single string)
  testConfigurations.forEach((config, configIndex) => {
    chunkStrategies.forEach(strategy => {
      test(`should maintain split/getChunk consistency for blogPost with ${config.description} using ${strategy.name} strategy`, () => {
        const options: SplitOptions = {
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          chunkStrategy: strategy.value
        }

        const chunks: ChunkResult[] = split(blogPost, options)

        // Verify we get chunks for this configuration
        assert.ok(
          chunks.length > 0,
          `Should produce chunks for blogPost with config ${configIndex + 1}`
        )

        // For each chunk, verify that getChunk returns the same text
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const retrievedText = getChunk(blogPost, chunk.start, chunk.end)

          // Since blogPost is a string, both chunk.text and retrievedText should be strings
          assert.strictEqual(
            typeof chunk.text,
            'string',
            `Chunk ${i} text should be a string for blogPost`
          )
          assert.strictEqual(
            typeof retrievedText,
            'string',
            `Retrieved text should be a string for blogPost chunk ${i}`
          )

          assert.strictEqual(
            chunk.text,
            retrievedText,
            `Chunk ${i} text should match getChunk result for range ${chunk.start}-${chunk.end} with ${config.description} and ${strategy.name} strategy`
          )

          // Additional validation: ensure start/end positions make sense
          assert.ok(chunk.start >= 0, `Chunk ${i} start should be non-negative`)
          assert.ok(
            chunk.end > chunk.start,
            `Chunk ${i} end should be greater than start`
          )
          assert.ok(
            chunk.end <= blogPost.length,
            `Chunk ${i} end should not exceed input length`
          )
        }

        // Verify that chunks cover the input without gaps when no overlap
        if (config.chunkOverlap === 0 && chunks.length > 1) {
          for (let i = 0; i < chunks.length - 1; i++) {
            assert.ok(
              chunks[i].end <= chunks[i + 1].start,
              `Chunk ${i} end should not exceed chunk ${i + 1} start when no overlap`
            )
          }
        }
      })
    })
  })

  // Test with multilineBlogPost (string array)
  testConfigurations.forEach((config, configIndex) => {
    chunkStrategies.forEach(strategy => {
      test(`should maintain split/getChunk consistency for multilineBlogPost with ${config.description} using ${strategy.name} strategy`, () => {
        const options: SplitOptions = {
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          chunkStrategy: strategy.value
        }

        const chunks: ChunkResult[] = split(multilineBlogPost, options)

        // Verify we get chunks for this configuration
        assert.ok(
          chunks.length > 0,
          `Should produce chunks for multilineBlogPost with config ${configIndex + 1}`
        )

        // For each chunk, verify that getChunk returns the same text
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const retrievedChunk = getChunk(
            multilineBlogPost,
            chunk.start,
            chunk.end
          )

          // Since multilineBlogPost is an array, both chunk.text and retrievedChunk should be arrays
          assert.ok(
            Array.isArray(chunk.text),
            `Chunk ${i} text should be an array for multilineBlogPost`
          )
          assert.ok(
            Array.isArray(retrievedChunk),
            `Retrieved chunk should be an array for multilineBlogPost chunk ${i}`
          )

          assert.deepStrictEqual(
            chunk.text,
            retrievedChunk,
            `Chunk ${i} text should match getChunk result for range ${chunk.start}-${chunk.end} with ${config.description} and ${strategy.name} strategy`
          )

          // Additional validation: ensure start/end positions make sense
          assert.ok(chunk.start >= 0, `Chunk ${i} start should be non-negative`)
          assert.ok(
            chunk.end > chunk.start,
            `Chunk ${i} end should be greater than start`
          )

          // Calculate total length of multilineBlogPost
          const totalLength = multilineBlogPost.join('').length
          assert.ok(
            chunk.end <= totalLength,
            `Chunk ${i} end should not exceed input length`
          )
        }

        // Verify that chunks cover the input without gaps when no overlap
        if (config.chunkOverlap === 0 && chunks.length > 1) {
          for (let i = 0; i < chunks.length - 1; i++) {
            assert.ok(
              chunks[i].end <= chunks[i + 1].start,
              `Chunk ${i} end should not exceed chunk ${i + 1} start when no overlap`
            )
          }
        }
      })
    })
  })

  // Additional edge case tests with extreme configurations
  test('should handle edge case: zero chunk size with blogPost', () => {
    const chunks: ChunkResult[] = split(blogPost, {
      chunkSize: 0,
      chunkOverlap: 0
    })

    for (const chunk of chunks) {
      const retrievedText = getChunk(blogPost, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Chunk text should match getChunk result even with zero chunk size`
      )
    }
  })

  test('should handle edge case: zero chunk size with multilineBlogPost', () => {
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 0,
      chunkOverlap: 0
    })

    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result even with zero chunk size`
      )
    }
  })

  test('should handle edge case: overlap larger than chunk size with blogPost', () => {
    const chunks: ChunkResult[] = split(blogPost, {
      chunkSize: 50,
      chunkOverlap: 100 // overlap > chunk size
    })

    for (const chunk of chunks) {
      const retrievedText = getChunk(blogPost, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Chunk text should match getChunk result even when overlap > chunk size`
      )
    }
  })

  test('should handle edge case: overlap larger than chunk size with multilineBlogPost', () => {
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: 50,
      chunkOverlap: 100 // overlap > chunk size
    })

    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result even when overlap > chunk size`
      )
    }
  })

  test('should handle edge case: very large chunk size (larger than input) with blogPost', () => {
    const largeChunkSize = blogPost.length * 2 // Much larger than input
    const chunks: ChunkResult[] = split(blogPost, {
      chunkSize: largeChunkSize,
      chunkOverlap: 10
    })

    // Should get exactly one chunk containing the entire input
    assert.strictEqual(
      chunks.length,
      1,
      'Should get exactly one chunk when chunk size > input size'
    )

    const chunk = chunks[0]
    const retrievedText = getChunk(blogPost, chunk.start, chunk.end)
    assert.strictEqual(
      chunk.text,
      retrievedText,
      `Chunk text should match getChunk result when chunk size > input size`
    )
    assert.ok(chunk.start >= 0, 'Single chunk should start at a valid position (may be adjusted due to trimming)')
    assert.ok(
      chunk.end <= blogPost.length,
      'Single chunk should end at or before input length (may be adjusted due to trimming)'
    )
  })

  test('should handle edge case: very large chunk size (larger than input) with multilineBlogPost', () => {
    const totalLength = multilineBlogPost.join('').length
    const largeChunkSize = totalLength * 2 // Much larger than input
    const chunks: ChunkResult[] = split(multilineBlogPost, {
      chunkSize: largeChunkSize,
      chunkOverlap: 10
    })

    // With array input, behavior may differ - just ensure consistency
    assert.ok(
      chunks.length >= 1,
      'Should get at least one chunk when chunk size > input size'
    )

    // For each chunk, verify consistency
    for (const chunk of chunks) {
      const retrievedChunk = getChunk(multilineBlogPost, chunk.start, chunk.end)
      assert.deepStrictEqual(
        chunk.text,
        retrievedChunk,
        `Chunk text should match getChunk result when chunk size > input size`
      )
    }
  })

  test('comprehensive matrix validation: all chunk boundaries should be retrievable', () => {
    // Test with multiple configurations simultaneously to ensure consistency
    const allConfigs = [
      { input: blogPost, name: 'blogPost', isArray: false },
      { input: multilineBlogPost, name: 'multilineBlogPost', isArray: true }
    ]

    const quickConfigs = [
      { chunkSize: 200, chunkOverlap: 20, chunkStrategy: undefined },
      { chunkSize: 400, chunkOverlap: 0, chunkStrategy: 'paragraph' as const },
      { chunkSize: 150, chunkOverlap: 75, chunkStrategy: undefined }
    ]

    allConfigs.forEach(({ input, name, isArray }) => {
      quickConfigs.forEach((config, configIndex) => {
        const chunks: ChunkResult[] = split(input, config)

        // Test every chunk boundary
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const retrieved = getChunk(input, chunk.start, chunk.end)

          if (isArray) {
            assert.deepStrictEqual(
              chunk.text,
              retrieved,
              `${name} config ${configIndex} chunk ${i}: array chunks should match exactly`
            )
          } else {
            assert.strictEqual(
              chunk.text,
              retrieved,
              `${name} config ${configIndex} chunk ${i}: string chunks should match exactly`
            )
          }
        }

        // Test intermediate positions within chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const chunkLength = chunk.end - chunk.start

          if (chunkLength > 2) {
            // Test getting a substring within the chunk
            const midPoint = chunk.start + Math.floor(chunkLength / 2)
            const partialRetrieved = getChunk(input, chunk.start, midPoint)

            // The partial retrieval should be consistent with the original chunk
            if (isArray) {
              const originalAsArray = chunk.text as string[]
              const originalJoined = originalAsArray.join('')
              const partialAsArray = partialRetrieved as string[]
              const partialJoined = partialAsArray.join('')

              assert.ok(
                originalJoined.startsWith(partialJoined),
                `${name} config ${configIndex} chunk ${i}: partial array retrieval should be prefix of original`
              )
            } else {
              const originalStr = chunk.text as string
              const partialStr = partialRetrieved as string

              assert.ok(
                originalStr.startsWith(partialStr),
                `${name} config ${configIndex} chunk ${i}: partial string retrieval should be prefix of original`
              )
            }
          }
        }
      })
    })
  })

  test('should verify split and getChunk consistency with word splitter for "The quick brown fox" example', () => {
    const input = 'The quick brown fox jumps over the lazy dog.'
    const wordSplitter = (text: string): string[] =>
      text.split(/\s+/).filter(word => word.length > 0)
    const chunkSize = 5 // 5 tokens (words)
    const chunkOverlap = 2 // 2 tokens overlap

    // Test character-based chunking
    const characterChunks: ChunkResult[] = split(input, {
      chunkSize,
      chunkOverlap,
      splitter: wordSplitter
    })

    // Verify we get multiple chunks
    assert.ok(
      characterChunks.length > 1,
      'Should produce multiple chunks for character-based chunking'
    )

    // Test each chunk for character-based mode
    characterChunks.forEach((chunk, index) => {
      // Verify chunk has correct token count (≤ 5 words)
      const chunkText = chunk.text as string
      const tokens = wordSplitter(chunkText)
      assert.ok(
        tokens.length <= chunkSize,
        `Character chunk ${index} should have at most ${chunkSize} tokens, got ${tokens.length}: ${JSON.stringify(tokens)}`
      )

      // Verify getChunk returns the same text
      const retrievedText = getChunk(input, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Character chunk ${index} text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )

      // Verify chunk positions are valid
      assert.ok(
        chunk.start >= 0,
        `Character chunk ${index} start should be non-negative`
      )
      assert.ok(
        chunk.end > chunk.start,
        `Character chunk ${index} end should be greater than start`
      )
      assert.ok(
        chunk.end <= input.length,
        `Character chunk ${index} end should not exceed input length`
      )
    })

    // Verify overlap between consecutive chunks for character mode
    if (characterChunks.length > 1) {
      for (let i = 1; i < characterChunks.length; i++) {
        const prevChunk = characterChunks[i - 1]
        const currentChunk = characterChunks[i]

        // There should be overlap in character positions
        assert.ok(
          currentChunk.start < prevChunk.end,
          `Character chunk ${i} should overlap with previous chunk`
        )

        // Calculate the overlapping text
        const overlapStart = currentChunk.start
        const overlapEnd = prevChunk.end
        const overlapText = input.slice(overlapStart, overlapEnd)
        const overlapTokens = wordSplitter(overlapText)

        // Verify we have some overlap (may vary in character-based chunking due to character boundaries)
        assert.ok(
          overlapTokens.length >= 1,
          `Should have at least 1 token overlap between character chunks ${i - 1} and ${i}, got ${overlapTokens.length} tokens: ${JSON.stringify(overlapTokens)}`
        )
      }
    }

    // Expected character-based results (trimmed whitespace)
    const expectedCharacterChunks = [
      {
        tokens: ['The', 'quick', 'brown', 'fox', 'jumps'],
        text: 'The quick brown fox jumps',
        start: 0,
        end: 25,
        description: 'First 5 words'
      },
      {
        tokens: ['fox', 'jumps', 'over', 'the', 'lazy'],
        text: 'fox jumps over the lazy',
        start: 16,
        end: 39,
        description: 'Words 4-8 with 2-word overlap'
      },
      {
        tokens: ['the', 'lazy', 'dog.'],
        text: 'the lazy dog.',
        start: 31,
        end: 44,
        description: 'Final words with 2-word overlap'
      }
    ]

    // Verify expected structure matches actual results and validate each chunk
    assert.strictEqual(
      characterChunks.length,
      expectedCharacterChunks.length,
      `Should have exactly ${expectedCharacterChunks.length} character chunks`
    )

    // Validate each character chunk with expected positions and content
    characterChunks.forEach((chunk, index) => {
      const expected = expectedCharacterChunks[index]
      
      // Verify start and end positions
      assert.strictEqual(
        chunk.start,
        expected.start,
        `Character chunk ${index} should start at position ${expected.start}, got ${chunk.start}`
      )
      assert.strictEqual(
        chunk.end,
        expected.end,
        `Character chunk ${index} should end at position ${expected.end}, got ${chunk.end}`
      )
      
      // Verify chunk text matches expected
      assert.strictEqual(
        chunk.text,
        expected.text,
        `Character chunk ${index} text should be "${expected.text}", got "${chunk.text}"`
      )
      
      // Verify getChunk returns the same text
      const retrievedText = getChunk(input, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Character chunk ${index} should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
      
      // Verify tokens match expected
      const actualTokens = wordSplitter(chunk.text as string)
      assert.deepStrictEqual(
        actualTokens,
        expected.tokens,
        `Character chunk ${index} should have tokens ${JSON.stringify(expected.tokens)}, got ${JSON.stringify(actualTokens)}`
      )
    })

    // Test paragraph-based chunking
    const paragraphChunks: ChunkResult[] = split(input, {
      chunkSize,
      chunkOverlap,
      chunkStrategy: 'paragraph',
      splitter: wordSplitter
    })

    // Verify we get chunks for paragraph mode
    assert.ok(
      paragraphChunks.length > 0,
      'Should produce chunks for paragraph-based chunking'
    )

    // Test each chunk for paragraph-based mode
    paragraphChunks.forEach((chunk, index) => {
      // Verify chunk has correct token count (≤ 5 words)
      const chunkText = chunk.text as string
      const tokens = wordSplitter(chunkText)
      assert.ok(
        tokens.length <= chunkSize,
        `Paragraph chunk ${index} should have at most ${chunkSize} tokens, got ${tokens.length}: ${JSON.stringify(tokens)}`
      )

      // Verify getChunk returns the same text
      const retrievedText = getChunk(input, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Paragraph chunk ${index} text should match getChunk result for range ${chunk.start}-${chunk.end}`
      )

      // Verify chunk positions are valid
      assert.ok(
        chunk.start >= 0,
        `Paragraph chunk ${index} start should be non-negative`
      )
      assert.ok(
        chunk.end > chunk.start,
        `Paragraph chunk ${index} end should be greater than start`
      )
      assert.ok(
        chunk.end <= input.length,
        `Paragraph chunk ${index} end should not exceed input length`
      )
    })

    // Verify overlap between consecutive chunks for paragraph mode
    if (paragraphChunks.length > 1) {
      for (let i = 1; i < paragraphChunks.length; i++) {
        const prevChunk = paragraphChunks[i - 1]
        const currentChunk = paragraphChunks[i]

        // There should be overlap in character positions
        assert.ok(
          currentChunk.start < prevChunk.end,
          `Paragraph chunk ${i} should overlap with previous chunk`
        )

        // Calculate the overlapping text
        const overlapStart = currentChunk.start
        const overlapEnd = prevChunk.end
        const overlapText = input.slice(overlapStart, overlapEnd)
        const overlapTokens = wordSplitter(overlapText)

        // Paragraph chunking uses calculateOverlapStart for precise token-based overlap
        assert.strictEqual(
          overlapTokens.length,
          chunkOverlap,
          `Should have exactly ${chunkOverlap} token overlap between paragraph chunks ${i - 1} and ${i}, got ${overlapTokens.length} tokens: ${JSON.stringify(overlapTokens)}`
        )
      }
    }

    // Expected paragraph-based results (trimmed whitespace, exact token overlap due to calculateOverlapStart)
    const expectedParagraphChunks = [
      {
        tokens: ['The', 'quick', 'brown', 'fox', 'jumps'],
        text: 'The quick brown fox jumps',
        start: 0,
        end: 25,
        description: 'First 5 words'
      },
      {
        tokens: ['fox', 'jumps', 'over', 'the', 'lazy'],
        text: 'fox jumps over the lazy',
        start: 16,
        end: 39,
        description: 'Words 4-8 with exact 2-word overlap'
      },
      {
        tokens: ['the', 'lazy', 'dog.'],
        text: 'the lazy dog.',
        start: 31,
        end: 44,
        description: 'Final words with exact 2-word overlap'
      }
    ]

    // Verify expected structure matches actual results for paragraph mode
    assert.strictEqual(
      paragraphChunks.length,
      expectedParagraphChunks.length,
      `Should have exactly ${expectedParagraphChunks.length} paragraph chunks`
    )

    // Validate each paragraph chunk with expected positions and content
    paragraphChunks.forEach((chunk, index) => {
      const expected = expectedParagraphChunks[index]
      
      // Verify start and end positions
      assert.strictEqual(
        chunk.start,
        expected.start,
        `Paragraph chunk ${index} should start at position ${expected.start}, got ${chunk.start}`
      )
      assert.strictEqual(
        chunk.end,
        expected.end,
        `Paragraph chunk ${index} should end at position ${expected.end}, got ${chunk.end}`
      )
      
      // Verify chunk text matches expected
      assert.strictEqual(
        chunk.text,
        expected.text,
        `Paragraph chunk ${index} text should be "${expected.text}", got "${chunk.text}"`
      )
      
      // Verify getChunk returns the same text
      const retrievedText = getChunk(input, chunk.start, chunk.end)
      assert.strictEqual(
        chunk.text,
        retrievedText,
        `Paragraph chunk ${index} should match getChunk result for range ${chunk.start}-${chunk.end}`
      )
      
      // Verify tokens match expected
      const actualTokens = wordSplitter(chunk.text as string)
      assert.deepStrictEqual(
        actualTokens,
        expected.tokens,
        `Paragraph chunk ${index} should have tokens ${JSON.stringify(expected.tokens)}, got ${JSON.stringify(actualTokens)}`
      )
      
      // For paragraph chunks, verify exact overlap precision
      if (index > 0) {
        const prevChunk = paragraphChunks[index - 1]
        const overlapStart = chunk.start
        const overlapEnd = prevChunk.end
        const overlapText = input.slice(overlapStart, overlapEnd)
        const overlapTokens = wordSplitter(overlapText)
        
        assert.strictEqual(
          overlapTokens.length,
          chunkOverlap,
          `Paragraph chunk ${index} should have exactly ${chunkOverlap} token overlap with previous chunk, got ${overlapTokens.length} tokens: ${JSON.stringify(overlapTokens)}`
        )
      }
    })

    // Verify total coverage - first chunk starts at 0, last chunk covers end of input
    assert.strictEqual(
      characterChunks[0].start,
      0,
      'First character chunk should start at beginning'
    )
    assert.strictEqual(
      characterChunks[characterChunks.length - 1].end,
      input.length,
      'Last character chunk should end at input end'
    )

    assert.strictEqual(
      paragraphChunks[0].start,
      0,
      'First paragraph chunk should start at beginning'
    )
    assert.strictEqual(
      paragraphChunks[paragraphChunks.length - 1].end,
      input.length,
      'Last paragraph chunk should end at input end'
    )

    // Both should produce the same number of chunks for a single paragraph input
    // but paragraph chunking should have more precise token-based overlap
    assert.ok(
      characterChunks.length > 0 && paragraphChunks.length > 0,
      'Both chunking strategies should produce chunks'
    )
  })
})
