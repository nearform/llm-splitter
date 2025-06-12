import { split, getChunk, iterateChunks } from '../src/chunker'
import { type SplitOptions } from '../src/types'
import { chunkByCharacter, chunkByGreedySlidingWindow } from '../src/utils'

describe('split', () => {
  test('should split a single string into correct sizes', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 3 })).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  test('should split an array of strings into correct sizes', () => {
    const input = ['abcde', 'fghij']
    expect(split(input, { chunkSize: 2 })).toEqual([
      'ab',
      'cd',
      'e',
      'fg',
      'hi',
      'j'
    ])
  })

  test('should return the whole string if smaller than chunk size', () => {
    const input = 'abc'
    expect(split(input, { chunkSize: 10 })).toEqual(['abc'])
  })

  test('should handle empty string input', () => {
    expect(split('', { chunkSize: 5 })).toEqual([''])
  })

  test('should handle empty array input', () => {
    expect(split([], { chunkSize: 5 })).toEqual([])
  })

  test('should handle empty array input (coverage)', () => {
    expect(split([])).toEqual([])
  })

  test('should use default chunk size if not provided', () => {
    const input = 'a'.repeat(600)
    const result = split(input)
    expect(result.length).toBe(2)
    expect(result[0].length).toBe(512)
    expect(result[1].length).toBe(88)
  })

  test('should split with overlap (sliding window)', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 4, chunkOverlap: 2 })).toEqual([
      'abcd',
      'cdef',
      'efgh',
      'ghij'
    ])
  })

  test('should use a custom lengthFunction (count vowels only)', () => {
    const input = 'abcdeiouxyz'
    const options: SplitOptions = {
      chunkSize: 2,
      lengthFunction: t => (t.match(/[aeiou]/g) || []).length
    }
    expect(split(input, options)).toEqual(['abcde', 'io', 'uxyz'])
  })

  test('should handle custom lengthFunction with overlap', () => {
    const input = 'aeioubcdfg'
    const options: SplitOptions = {
      chunkSize: 3,
      chunkOverlap: 1,
      lengthFunction: t => (t.match(/[aeiou]/g) || []).length
    }
    expect(split(input, options)).toEqual(['aei', 'ioubcdfg'])
  })

  test('should split by paragraph boundaries', () => {
    const input = 'Para1 line1\nPara1 line2\n\nPara2 line1\n\nPara3'
    const result = split(input, { chunkSize: 100, chunkStrategy: 'paragraph' })
    expect(result).toEqual(['Para1 line1\nPara1 line2', 'Para2 line1', 'Para3'])
  })

  test('should perform greedy unit-based chunking with overlap (paragraph)', () => {
    const input = 'A\n\nB\n\nC\n\nD'
    const result = split(input, {
      chunkSize: 3,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    expect(result).toEqual(['A', 'B', 'C', 'D'])
  })

  test('should perform greedy unit-based chunking with overlap and join multiple units (paragraph)', () => {
    const input = 'A1\n\nB2\n\nC3\n\nD4'
    const result = split(input, {
      chunkSize: 6,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    expect(result).toEqual(['A1\n\nB2', 'B2\n\nC3', 'C3\n\nD4', 'D4'])
  })

  test('should handle empty string with chunkStrategy', () => {
    expect(split('', { chunkStrategy: 'paragraph' })).toEqual([''])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    expect(split(['', ''], { chunkStrategy: 'paragraph' })).toEqual(['', ''])
  })

  test('should handle array of empty strings', () => {
    expect(split(['', ''])).toEqual(['', ''])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    expect(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' })
    ).toEqual(['', ''])
  })

  test('should cover array input branch for unit-based chunking', () => {
    const input = ['A', 'B', 'C']
    // This triggers the Array.isArray(text) && text !== texts branch
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual(['A', 'B', 'C'])
  })

  test('should cover array input branch for unit-based chunking with empty strings', () => {
    const input = ['', 'A', '']
    // This triggers the Array.isArray(text) && text !== texts branch for empty and non-empty
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual(['', 'A', ''])
  })

  test('should cover array input branch for unit-based chunking with empty array', () => {
    const input: string[] = []
    // This triggers the Array.isArray(text) && text !== texts branch with an empty array
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([])
  })

  test('should cover array input mapping for unit-based chunking with multiple non-empty strings', () => {
    const input = ['A', 'B', 'C', 'D']
    // This triggers the Array.isArray(text) && text !== texts branch and uses the mapped result
    const result = split(input, { chunkSize: 1, chunkStrategy: 'paragraph' })
    expect(result).toEqual(['A', 'B', 'C', 'D'])
  })

  test('split and getChunk are co-functions', () => {
    const input = ['abcde', 'fghij']
    let offset = 0
    for (const chunk of iterateChunks(input, { chunkSize: 2 })) {
      const chunkFromGetChunk = getChunk(input, offset, offset + chunk.length)
      const chunkStr = Array.isArray(chunkFromGetChunk) ? chunkFromGetChunk.join('') : chunkFromGetChunk
      expect(chunkStr).toBe(chunk)
      offset += chunk.length
    }
  })
})

describe('getChunk', () => {
  test('should return the full string if no start/end provided', () => {
    expect(getChunk('abcdefgh')).toBe('abcdefgh')
    expect(getChunk(['abc', 'def', 'gh'])).toEqual(['abc', 'def', 'gh'])
  })

  test('should return substring for start only', () => {
    expect(getChunk('abcdefgh', 2)).toBe('cdefgh')
    expect(getChunk(['abc', 'def', 'gh'], 3)).toEqual(['def', 'gh'])
  })

  test('should return substring for start and end', () => {
    expect(getChunk('abcdefgh', 2, 5)).toBe('cde')
    expect(getChunk(['abc', 'def', 'gh'], 1, 7)).toEqual(['bc', 'def', 'g'])
  })

  test('should handle end beyond input length', () => {
    expect(getChunk('abc', 1, 10)).toBe('bc')
    expect(getChunk(['abc', 'def'], 2, 10)).toEqual(['c', 'def'])
  })

  test('should handle start >= end', () => {
    expect(getChunk('abc', 2, 2)).toBe('')
    expect(getChunk(['abc', 'def'], 4, 2)).toEqual([])
  })

  test('should handle empty input', () => {
    expect(getChunk('', 0, 2)).toBe('')
    expect(getChunk([], 0, 2)).toEqual([])
  })
})

describe('split (coverage edge cases)', () => {
  test('should cover allUnitsFit branch for paragraph', () => {
    const input = 'A\n\nB'
    // Both paragraphs fit in one chunk
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual(['A', 'B'])
  })

  test('should handle a single unit larger than chunk size', () => {
    const input = 'ThisIsAVeryLongParagraph'
    // Paragraph is longer than chunkSize, so it should still yield it
    const result = split(input, { chunkSize: 5, chunkStrategy: 'paragraph' })
    expect(result[0]).toBe('ThisIsAVeryLongParagraph')
  })

  test('should cover lengthFunction branch for character-based chunking', () => {
    const input = 'abcdef'
    // Use a custom lengthFunction to trigger the branch
    const result = split(input, { chunkSize: 2, lengthFunction: t => t.length })
    expect(result[0]).toBe('ab')
  })

  test("should cover the 'break' branch when currentLen > chunkSize in character-based chunking", () => {
    const input = 'abcde'
    // chunkSize 2, so after 'ab', 'c' will be a new chunk
    const result = split(input, { chunkSize: 2 })
    expect(result).toEqual(['ab', 'cd', 'e'])
  })

  test("should cover the 'end === start' branch in character-based chunking", () => {
    const input = 'a'
    // chunkSize 0 will force end === start
    const result = split(input, { chunkSize: 0 })
    expect(result[0]).toBe('a')
  })
})
