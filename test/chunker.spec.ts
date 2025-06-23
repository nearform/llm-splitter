import { split, getChunk, iterateChunks } from '../src/chunker'
import { type SplitOptions } from '../src/types'

describe('split', () => {
  test('should split a single string into correct sizes', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 3 })).toEqual([
      { text: 'abc', start: 0, end: 3 },
      { text: 'def', start: 3, end: 6 },
      { text: 'ghi', start: 6, end: 9 },
      { text: 'j', start: 9, end: 10 }
    ])
  })

  test('should split an array of strings into correct sizes', () => {
    const input = ['abcde', 'fghij']
    expect(split(input, { chunkSize: 2 })).toEqual([
      { text: ['ab'], start: 0, end: 2 },
      { text: ['cd'], start: 2, end: 4 },
      { text: ['e'], start: 4, end: 5 },
      { text: ['fg'], start: 5, end: 7 },
      { text: ['hi'], start: 7, end: 9 },
      { text: ['j'], start: 9, end: 10 }
    ])
  })

  test('should return the whole string if smaller than chunk size', () => {
    const input = 'abc'
    expect(split(input, { chunkSize: 10 })).toEqual([
      { text: 'abc', start: 0, end: 3 }
    ])
  })

  test('should handle empty string input', () => {
    expect(split('', { chunkSize: 5 })).toEqual([
      { text: '', start: 0, end: 0 }
    ])
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
    expect((result[0].text as string).length).toBe(512)
    expect((result[1].text as string).length).toBe(88)
    expect(result[0].start).toBe(0)
    expect(result[0].end).toBe(512)
    expect(result[1].start).toBe(512)
    expect(result[1].end).toBe(600)
  })

  test('should split with overlap (sliding window)', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 4, chunkOverlap: 2 })).toEqual([
      { text: 'abcd', start: 0, end: 4 },
      { text: 'cdef', start: 2, end: 6 },
      { text: 'efgh', start: 4, end: 8 },
      { text: 'ghij', start: 6, end: 10 }
    ])
  })

  test('should use a custom lengthFunction (count vowels only)', () => {
    const input = 'abcdeiouxyz'
    const options: SplitOptions = {
      chunkSize: 2,
      lengthFunction: t => (t.match(/[aeiou]/g) || []).length
    }
    expect(split(input, options)).toEqual([
      { text: 'abcde', start: 0, end: 5 },
      { text: 'io', start: 5, end: 7 },
      { text: 'uxyz', start: 7, end: 11 }
    ])
  })

  test('should handle custom lengthFunction with overlap', () => {
    const input = 'aeioubcdfg'
    const options: SplitOptions = {
      chunkSize: 3,
      chunkOverlap: 1,
      lengthFunction: t => (t.match(/[aeiou]/g) || []).length
    }
    expect(split(input, options)).toEqual([
      { text: 'aei', start: 0, end: 3 },
      { text: 'ioubcdfg', start: 2, end: 10 }
    ])
  })

  test('should split by paragraph boundaries', () => {
    const input = 'Para1 line1\nPara1 line2\n\nPara2 line1\n\nPara3'
    const result = split(input, { chunkSize: 100, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      { text: 'Para1 line1\nPara1 line2', start: 0, end: 23 },
      { text: 'Para2 line1', start: 25, end: 36 },
      { text: 'Para3', start: 38, end: 43 }
    ])
  })

  test('should perform greedy unit-based chunking with overlap (paragraph)', () => {
    const input = 'A\n\nB\n\nC\n\nD'
    const result = split(input, {
      chunkSize: 3,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    expect(result).toEqual([
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 3, end: 4 },
      { text: 'C', start: 6, end: 7 },
      { text: 'D', start: 9, end: 10 }
    ])
  })

  test('should perform greedy unit-based chunking with overlap and join multiple units (paragraph)', () => {
    const input = 'A1\n\nB2\n\nC3\n\nD4'
    const result = split(input, {
      chunkSize: 6,
      chunkOverlap: 1,
      chunkStrategy: 'paragraph'
    })
    expect(result).toEqual([
      { text: 'A1\n\nB2', start: 0, end: 6 },
      { text: 'B2\n\nC3', start: 4, end: 10 },
      { text: 'C3\n\nD4', start: 8, end: 14 },
      { text: 'D4', start: 12, end: 14 }
    ])
  })

  test('should handle empty string with chunkStrategy', () => {
    expect(split('', { chunkStrategy: 'paragraph' })).toEqual([
      { text: '', start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    expect(split(['', ''], { chunkStrategy: 'paragraph' })).toEqual([
      { text: [''], start: 0, end: 0 },
      { text: [''], start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings', () => {
    expect(split(['', ''])).toEqual([
      { text: [''], start: 0, end: 0 },
      { text: [''], start: 0, end: 0 }
    ])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    expect(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' })
    ).toEqual([
      { text: [''], start: 0, end: 0 },
      { text: [''], start: 0, end: 0 }
    ])
  })

  test('should cover array input branch for unit-based chunking', () => {
    const input = ['A', 'B', 'C']
    // This triggers the Array.isArray(text) && text !== texts branch
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      { text: ['A'], start: 0, end: 1 },
      { text: ['B'], start: 1, end: 2 },
      { text: ['C'], start: 2, end: 3 }
    ])
  })

  test('should cover array input branch for unit-based chunking with empty strings', () => {
    const input = ['', 'A', '']
    // This triggers the Array.isArray(text) && text !== texts branch for empty and non-empty
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      { text: [''], start: 0, end: 0 },
      { text: ['A'], start: 0, end: 1 },
      { text: [''], start: 1, end: 1 }
    ])
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
    expect(result).toEqual([
      { text: ['A'], start: 0, end: 1 },
      { text: ['B'], start: 1, end: 2 },
      { text: ['C'], start: 2, end: 3 },
      { text: ['D'], start: 3, end: 4 }
    ])
  })

  test('split and getChunk are co-functions', () => {
    // Generate a large array of random word strings of varying sizes
    function randomWord() {
      const length = Math.floor(Math.random() * 16) + 2
      return Array.from({ length }, () =>
        String.fromCharCode(97 + Math.floor(Math.random() * 26))
      ).join('')
    }
    function randomPhrase() {
      const wordCount = Math.floor(Math.random() * 50) + 5
      return Array.from({ length: wordCount }, randomWord).join(' ')
    }
    // At least a few hundred words total
    let totalWords = 0
    const input: string[] = []
    while (totalWords < 500) {
      const phrase = randomPhrase()
      totalWords += phrase.split(' ').length
      input.push(phrase)
    }
    let offset = 0
    for (const chunk of iterateChunks(input, { chunkSize: 50 })) {
      const chunkLength = chunk.end - chunk.start
      const chunkFromGetChunk = getChunk(input, offset, offset + chunkLength)
      const chunkStr = Array.isArray(chunkFromGetChunk)
        ? chunkFromGetChunk.join('')
        : chunkFromGetChunk
      const expectedText = Array.isArray(chunk.text)
        ? chunk.text.join('')
        : chunk.text
      expect(chunkStr).toBe(expectedText)
      offset += chunkLength
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
    expect(result).toEqual([
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 3, end: 4 }
    ])
  })

  test('should handle a single unit larger than chunk size', () => {
    const input = 'ThisIsAVeryLongParagraph'
    // Paragraph is longer than chunkSize, so it should still yield it
    const result = split(input, { chunkSize: 5, chunkStrategy: 'paragraph' })
    expect(result[0]).toEqual({
      text: 'ThisIsAVeryLongParagraph',
      start: 0,
      end: 24
    })
  })

  test('should cover lengthFunction branch for character-based chunking', () => {
    const input = 'abcdef'
    // Use a custom lengthFunction to trigger the branch
    const result = split(input, { chunkSize: 2, lengthFunction: t => t.length })
    expect(result[0]).toEqual({ text: 'ab', start: 0, end: 2 })
  })

  test("should cover the 'break' branch when currentLen > chunkSize in character-based chunking", () => {
    const input = 'abcde'
    // chunkSize 2, so after 'ab', 'c' will be a new chunk
    const result = split(input, { chunkSize: 2 })
    expect(result).toEqual([
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'e', start: 4, end: 5 }
    ])
  })

  test("should cover the 'end === start' branch in character-based chunking", () => {
    const input = 'a'
    // chunkSize 0 will force end === start
    const result = split(input, { chunkSize: 0 })
    expect(result[0]).toEqual({ text: 'a', start: 0, end: 1 })
  })
})
