import { test, describe } from 'node:test'
import assert from 'node:assert'
import { split, getChunk, iterateChunks } from '../src/chunker.js'
import type { SplitOptions, ChunkResult } from '../src/types.js'

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
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'e', start: 4, end: 5 },
      { text: 'fg', start: 5, end: 7 },
      { text: 'hi', start: 7, end: 9 },
      { text: 'j', start: 9, end: 10 }
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
    assert.strictEqual(result[0].text.length, 512)
    assert.strictEqual(result[1].text.length, 88)
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
    // With joiner length not counting toward chunk size, more units fit per chunk
    // Final 'D' is redundant since it's already covered by 'C\n\nD' with overlap
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
    // With precise token-based overlap, we get exactly 1 token overlap ('3' from 'C3')
    assert.deepStrictEqual(result, [
      { text: 'A1\n\nB2\n\nC3', start: 0, end: 10 },
      { text: '3\n\nD4', start: 9, end: 14 } // '3' is the exact 1-token overlap
    ])
  })

  test('should handle empty string with chunkStrategy', () => {
    assert.deepStrictEqual(split('', { chunkStrategy: 'paragraph' }), [
      { text: '', start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    assert.deepStrictEqual(split(['', ''], { chunkStrategy: 'paragraph' }), [
      { text: '', start: 0, end: 0 },
      { text: '', start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings', () => {
    assert.deepStrictEqual(split(['', '']), [
      { text: '', start: 0, end: 0 },
      { text: '', start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    assert.deepStrictEqual(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' }),
      [
        { text: '', start: 0, end: 0 },
        { text: '', start: 0, end: 0 }
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
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 1, end: 2 },
      { text: 'C', start: 2, end: 3 }
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
      { text: '', start: 0, end: 0 },
      { text: 'A', start: 0, end: 1 },
      { text: '', start: 1, end: 1 }
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
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 1, end: 2 },
      { text: 'C', start: 2, end: 3 },
      { text: 'D', start: 3, end: 4 }
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
      const expectedText: string = chunk.text
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
  test('should handle array input and maintain string output format', () => {
    const input: string[] = ['abc', 'def']
    const result: ChunkResult[] = split(input, { chunkSize: 2 })
    assert.strictEqual(typeof result[0].text, 'string') // Should be string format
    assert.strictEqual(result[0].text, 'ab')
    assert.strictEqual(result[1].text, 'c')
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
    assert.strictEqual(typeof result[0].text, 'string') // Should be string format
    assert.strictEqual(
      result[0].text,
      'Para1 line1\nPara1 line2\n\nPara2 line1'
    )
    assert.strictEqual(result[1].text, 'Para3\n\nPara4')
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
    assert.strictEqual(result[0].text, '') // First chunk should be empty string
    assert.strictEqual(result[1].text, 'ab')
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
    assert.strictEqual(typeof result[0].text, 'string') // Should be string format
    assert.strictEqual(result[0].text, 'Para1\n\nPara2')
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
    assert.strictEqual(typeof result[0].text, 'string') // Should be string format
  })

  // Test for chunker.ts:79 - specific array input with empty strings and custom splitter
  test('should handle complex array input with empty strings and custom splitter function', () => {
    const input: string[] = ['', 'test', '']
    const result: ChunkResult[] = split(input, {
      chunkSize: 10,
      splitter: (text: string) => text.split('')
    })
    assert.ok(result.length > 0)
    assert.strictEqual(result[0].text, '')
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
    assert.strictEqual(typeof result[0].text, 'string') // Should be string format
  })
})
