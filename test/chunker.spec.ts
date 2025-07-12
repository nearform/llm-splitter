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
    assert.deepStrictEqual(split('', { chunkSize: 5 }), [
      { text: '', start: 0, end: 0 }
    ])
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
    // With direct extraction from original text (no synthetic overlap), we get exact boundaries
    // This ensures split/getChunk consistency as requested by the user
    assert.deepStrictEqual(result, [
      { text: 'A\n\nB\n\nC', start: 0, end: 7 },
      { text: 'D', start: 9, end: 10 }
    ])
  })

  test('should perform greedy unit-based chunking with overlap and join multiple units (paragraph)', () => {
    const input: string = 'A1\n\nB2\n\nC3\n\nD4'
    const result: ChunkResult[] = split(input, {
      chunkSize: 6,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    // With direct extraction from original text (no synthetic overlap), we get exact boundaries
    // This ensures split/getChunk consistency as requested by the user
    assert.deepStrictEqual(result, [
      { text: 'A1\n\nB2\n\nC3', start: 0, end: 10 },
      { text: 'D4', start: 12, end: 14 }
    ])
  })

  test('should handle empty string with chunkStrategy', () => {
    assert.deepStrictEqual(split('', { chunkStrategy: 'paragraph' }), [
      { text: '', start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    assert.deepStrictEqual(split(['', ''], { chunkStrategy: 'paragraph' }), [
      { text: [''], start: 0, end: 0 },
      { text: [''], start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings', () => {
    assert.deepStrictEqual(split(['', '']), [
      { text: [''], start: 0, end: 0 },
      { text: [''], start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    assert.deepStrictEqual(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' }),
      [
        { text: [''], start: 0, end: 0 },
        { text: [''], start: 0, end: 0 }
      ]
    )
  })

  test('should cover array input branch for unit-based chunking', () => {
    const input: string[] = ['A', 'B', 'C']
    // This triggers the Array.isArray(text) && text !== texts branch
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [
      { text: ['A'], start: 0, end: 1 },
      { text: ['B'], start: 1, end: 2 },
      { text: ['C'], start: 2, end: 3 }
    ])
  })

  test('should cover array input branch for unit-based chunking with empty strings', () => {
    const input: string[] = ['', 'A', '']
    // This triggers the Array.isArray(text) && text !== texts branch for empty and non-empty
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result, [
      { text: [''], start: 0, end: 0 },
      { text: ['A'], start: 0, end: 1 },
      { text: [''], start: 1, end: 1 }
    ])
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
    let offset: number = 0
    for (const chunk of iterateChunks(input, { chunkSize: 50 })) {
      const chunkLength: number = chunk.end - chunk.start
      const chunkFromGetChunk: string | string[] = getChunk(
        input,
        offset,
        offset + chunkLength
      )
      const chunkStr: string = Array.isArray(chunkFromGetChunk)
        ? chunkFromGetChunk.join('')
        : chunkFromGetChunk
      const expectedText: string = Array.isArray(chunk.text)
        ? chunk.text.join('')
        : chunk.text
      assert.strictEqual(chunkStr, expectedText)
      offset += chunkLength
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

  // Test for chunker.ts:38 - getChunk with startIndex === null
  test('getChunk should return empty array when start is beyond input length', () => {
    const input: string[] = ['abc', 'def']
    const result: string | string[] = getChunk(input, 100, 105) // start way beyond length
    assert.deepStrictEqual(result, [])
  })

  // Test for chunker.ts:119 - array output for character-based chunking with array input
  test('should handle array input and maintain array output format', () => {
    const input: string[] = ['abc', 'def']
    const result: ChunkResult[] = split(input, { chunkSize: 2 })
    assert.deepStrictEqual(result[0].text, ['ab']) // Should be array format
    assert.deepStrictEqual(result[1].text, ['c'])
  })

  // Test for chunker.ts:99 - array input branch for paragraph strategy
  test('should handle array input with paragraph strategy', () => {
    const input: string[] = [
      'Para1 line1\nPara1 line2\n\nPara2 line1',
      'Para3\n\nPara4'
    ]
    const result: ChunkResult[] = split(input, {
      chunkSize: 100,
      chunkStrategy: 'paragraph'
    })
    assert.deepStrictEqual(result[0].text, [
      'Para1 line1\nPara1 line2\n\nPara2 line1'
    ]) // Should be array format
    assert.deepStrictEqual(result[1].text, ['Para3\n\nPara4'])
  })

  // Test for utils.ts:85 - bestEnd === start case (force at least one character)
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

  // Test for chunker.ts line 79 - array input with empty string and splitter
  test('should handle array input with empty string and custom splitter', () => {
    const input: string[] = ['', 'abc']
    const charSplitter: (text: string) => string[] = (text: string) =>
      text.split('')
    const result: ChunkResult[] = split(input, {
      chunkSize: 2,
      splitter: charSplitter
    })
    assert.deepStrictEqual(result[0].text, ['']) // First chunk should be empty array element
    assert.deepStrictEqual(result[1].text, ['ab'])
  })

  // Test for chunker.ts line 99 - array input with paragraph strategy and splitter
  test('should handle array input with paragraph strategy and custom splitter', () => {
    const input: string[] = ['Para1\n\nPara2', 'Para3']
    const wordSplitter: (text: string) => string[] = (text: string) =>
      text.split(/\s+/)
    const result: ChunkResult[] = split(input, {
      chunkSize: 5,
      chunkStrategy: 'paragraph',
      splitter: wordSplitter
    })
    assert.deepStrictEqual(result[0].text, ['Para1\n\nPara2']) // Should use array format
  })

  // Test for chunker.ts line 119 - array input character chunking with splitter
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

  // Test for chunker.ts:79 - specific array input with empty strings and custom splitter
  test('should handle complex array input with empty strings and custom splitter function', () => {
    const input: string[] = ['', 'test', '']
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      splitter: (text: string) => text.split('')
    })
    assert.ok(result.length > 0)
    assert.deepStrictEqual(result[0].text, [''])
  })

  // Test for chunker.ts:119 - array character chunking with specific splitter that affects length
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

    // Verify no gaps or overlaps between chunks
    for (let i = 0; i < chunks.length - 1; i++) {
      assert.strictEqual(
        chunks[i].end,
        chunks[i + 1].start,
        `Chunk ${i} end should equal chunk ${i + 1} start when no overlap`
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
    assert.strictEqual(chunk.start, 0, 'Single chunk should start at 0')
    assert.strictEqual(
      chunk.end,
      blogPost.length,
      'Single chunk should end at input length'
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
})
