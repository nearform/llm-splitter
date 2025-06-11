import {
  split,
  type SplitOptions,
  getChunk,
  chunkByCharacter,
  chunkByGreedySlidingWindow
} from '../src/chunker'

describe('split', () => {
  test('should split a single string into correct sizes', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 3 })).toEqual([
      {
        chunk: 'abc',
        startIndex: 0,
        startPosition: 0,
        endIndex: 2,
        endPosition: 3
      },
      {
        chunk: 'def',
        startIndex: 3,
        startPosition: 3,
        endIndex: 5,
        endPosition: 6
      },
      {
        chunk: 'ghi',
        startIndex: 6,
        startPosition: 6,
        endIndex: 8,
        endPosition: 9
      },
      {
        chunk: 'j',
        startIndex: 9,
        startPosition: 9,
        endIndex: 9,
        endPosition: 10
      }
    ])
  })

  test('should split an array of strings into correct sizes', () => {
    const input = ['abcde', 'fghij']
    expect(split(input, { chunkSize: 2 })).toEqual([
      {
        chunk: 'ab',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 2
      },
      {
        chunk: 'cd',
        startIndex: 2,
        startPosition: 2,
        endIndex: 3,
        endPosition: 4
      },
      {
        chunk: 'e',
        startIndex: 4,
        startPosition: 4,
        endIndex: 4,
        endPosition: 5
      },
      {
        chunk: 'fg',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 2
      },
      {
        chunk: 'hi',
        startIndex: 2,
        startPosition: 2,
        endIndex: 3,
        endPosition: 4
      },
      {
        chunk: 'j',
        startIndex: 4,
        startPosition: 4,
        endIndex: 4,
        endPosition: 5
      }
    ])
  })

  test('should return the whole string if smaller than chunk size', () => {
    const input = 'abc'
    expect(split(input, { chunkSize: 10 })).toEqual([
      {
        chunk: 'abc',
        startIndex: 0,
        startPosition: 0,
        endIndex: 2,
        endPosition: 3
      }
    ])
  })

  test('should handle empty string input', () => {
    expect(split('', { chunkSize: 5 })).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
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
    expect(result[0].chunk.length).toBe(512)
    expect(result[1].chunk.length).toBe(88)
  })

  test('should split with overlap (sliding window)', () => {
    const input = 'abcdefghij'
    expect(split(input, { chunkSize: 4, chunkOverlap: 2 })).toEqual([
      {
        chunk: 'abcd',
        startIndex: 0,
        startPosition: 0,
        endIndex: 3,
        endPosition: 4
      },
      {
        chunk: 'cdef',
        startIndex: 2,
        startPosition: 2,
        endIndex: 5,
        endPosition: 6
      },
      {
        chunk: 'efgh',
        startIndex: 4,
        startPosition: 4,
        endIndex: 7,
        endPosition: 8
      },
      {
        chunk: 'ghij',
        startIndex: 6,
        startPosition: 6,
        endIndex: 9,
        endPosition: 10
      }
    ])
  })

  test('should use a custom lengthFunction (count vowels only)', () => {
    const input = 'abcdeiouxyz'
    const options: SplitOptions = {
      chunkSize: 2,
      lengthFunction: t => (t.match(/[aeiou]/g) || []).length
    }
    expect(split(input, options)).toEqual([
      {
        chunk: 'abcde',
        startIndex: 0,
        startPosition: 0,
        endIndex: 4,
        endPosition: 5
      },
      {
        chunk: 'io',
        startIndex: 5,
        startPosition: 5,
        endIndex: 6,
        endPosition: 7
      },
      {
        chunk: 'uxyz',
        startIndex: 7,
        startPosition: 7,
        endIndex: 10,
        endPosition: 11
      }
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
      {
        chunk: 'aei',
        startIndex: 0,
        startPosition: 0,
        endIndex: 2,
        endPosition: 3
      },
      {
        chunk: 'ioubcdfg',
        startIndex: 2,
        startPosition: 2,
        endIndex: 9,
        endPosition: 10
      }
    ])
  })

  test('should split by paragraph boundaries', () => {
    const input = 'Para1 line1\nPara1 line2\n\nPara2 line1\n\nPara3'
    const result = split(input, { chunkSize: 100, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      {
        chunk: 'Para1 line1\nPara1 line2',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 23
      },
      {
        chunk: 'Para2 line1',
        startIndex: 1,
        startPosition: 25,
        endIndex: 1,
        endPosition: 36
      },
      {
        chunk: 'Para3',
        startIndex: 2,
        startPosition: 38,
        endIndex: 2,
        endPosition: 43
      }
    ])
  })

  test('should split by sentence boundaries', () => {
    const input = 'Hello world! How are you? I am fine. This is a test.'
    const result = split(input, { chunkSize: 100, chunkStrategy: 'sentence' })
    expect(result).toEqual([
      {
        chunk: 'Hello world!',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 13
      },
      {
        chunk: 'How are you?',
        startIndex: 1,
        startPosition: 13,
        endIndex: 1,
        endPosition: 26
      },
      {
        chunk: 'I am fine.',
        startIndex: 2,
        startPosition: 26,
        endIndex: 2,
        endPosition: 37
      },
      {
        chunk: 'This is a test.',
        startIndex: 3,
        startPosition: 37,
        endIndex: 3,
        endPosition: 52
      }
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
      {
        chunk: 'A',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'B',
        startIndex: 1,
        startPosition: 3,
        endIndex: 1,
        endPosition: 4
      },
      {
        chunk: 'C',
        startIndex: 2,
        startPosition: 6,
        endIndex: 2,
        endPosition: 7
      },
      {
        chunk: 'D',
        startIndex: 3,
        startPosition: 9,
        endIndex: 3,
        endPosition: 10
      }
    ])
  })

  test('should perform greedy unit-based chunking with overlap (sentence)', () => {
    const input = 'A. B. C. D.'
    const result = split(input, {
      chunkSize: 3,
      chunkOverlap: 1,
      chunkStrategy: 'sentence'
    })
    expect(result).toEqual([
      {
        chunk: 'A.',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 3
      },
      {
        chunk: 'B.',
        startIndex: 1,
        startPosition: 3,
        endIndex: 1,
        endPosition: 6
      },
      {
        chunk: 'C.',
        startIndex: 2,
        startPosition: 6,
        endIndex: 2,
        endPosition: 9
      },
      {
        chunk: 'D.',
        startIndex: 3,
        startPosition: 9,
        endIndex: 3,
        endPosition: 11
      }
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
      {
        chunk: 'A1\n\nB2',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 6
      },
      {
        chunk: 'B2\n\nC3',
        startIndex: 1,
        startPosition: 4,
        endIndex: 2,
        endPosition: 10
      },
      {
        chunk: 'C3\n\nD4',
        startIndex: 2,
        startPosition: 8,
        endIndex: 3,
        endPosition: 14
      },
      {
        chunk: 'D4',
        startIndex: 3,
        startPosition: 12,
        endIndex: 3,
        endPosition: 14
      }
    ])
  })

  test('should perform greedy unit-based chunking with overlap and join multiple units (sentence)', () => {
    const input = 'A1. B2. C3. D4.'
    const result = split(input, {
      chunkSize: 8,
      chunkOverlap: 1,
      chunkStrategy: 'sentence'
    })
    expect(result).toEqual([
      {
        chunk: 'A1. B2.',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 8
      },
      {
        chunk: 'B2. C3.',
        startIndex: 1,
        startPosition: 4,
        endIndex: 2,
        endPosition: 12
      },
      {
        chunk: 'C3. D4.',
        startIndex: 2,
        startPosition: 8,
        endIndex: 3,
        endPosition: 15
      },
      {
        chunk: 'D4.',
        startIndex: 3,
        startPosition: 12,
        endIndex: 3,
        endPosition: 15
      }
    ])
  })

  test('should handle empty string with chunkStrategy', () => {
    expect(split('', { chunkStrategy: 'paragraph' })).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
    expect(split('', { chunkStrategy: 'sentence' })).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
  })

  test('should handle array of empty strings with chunkStrategy', () => {
    expect(split(['', ''], { chunkStrategy: 'paragraph' })).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
    expect(split(['', ''], { chunkStrategy: 'sentence' })).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
  })

  test('should handle array of empty strings', () => {
    expect(split(['', ''])).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
  })

  test('should handle array of empty strings with chunkSize and chunkStrategy', () => {
    expect(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'paragraph' })
    ).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
    expect(
      split(['', ''], { chunkSize: 5, chunkStrategy: 'sentence' })
    ).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    ])
  })

  test('should cover array input branch for unit-based chunking', () => {
    const input = ['A', 'B', 'C']
    // This triggers the Array.isArray(text) && text !== texts branch
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      {
        chunk: 'A',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'B',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'C',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      }
    ])
  })

  test('should cover array input branch for unit-based chunking with empty strings', () => {
    const input = ['', 'A', '']
    // This triggers the Array.isArray(text) && text !== texts branch for empty and non-empty
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      },
      {
        chunk: 'A',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
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
      {
        chunk: 'A',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'B',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'C',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'D',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      }
    ])
  })

  test('split and getChunk are co-functions', () => {
    const input = ['abcde', 'fghij']
    const [{ chunk, startIndex, endIndex }] = split(input, { chunkSize: 2 })
    expect(getChunk(input, startIndex, endIndex + 1)).toBe(chunk)
  })
})

describe('getChunk', () => {
  test('should return the full string if no start/end provided', () => {
    expect(getChunk('abcdefgh')).toBe('abcdefgh')
    expect(getChunk(['abc', 'def', 'gh'])).toBe('abcdefgh')
  })

  test('should return substring for start only', () => {
    expect(getChunk('abcdefgh', 2)).toBe('cdefgh')
    expect(getChunk(['abc', 'def', 'gh'], 3)).toBe('defgh')
  })

  test('should return substring for start and end', () => {
    expect(getChunk('abcdefgh', 2, 5)).toBe('cde')
    expect(getChunk(['abc', 'def', 'gh'], 1, 7)).toBe('bcdefg')
  })

  test('should handle end beyond input length', () => {
    expect(getChunk('abc', 1, 10)).toBe('bc')
    expect(getChunk(['abc', 'def'], 2, 10)).toBe('cdef')
  })

  test('should handle start >= end', () => {
    expect(getChunk('abc', 2, 2)).toBe('')
    expect(getChunk(['abc', 'def'], 4, 2)).toBe('')
  })

  test('should handle empty input', () => {
    expect(getChunk('', 0, 2)).toBe('')
    expect(getChunk([], 0, 2)).toBe('')
  })
})

describe('split (coverage edge cases)', () => {
  test('should cover allUnitsFit branch for paragraph', () => {
    const input = 'A\n\nB'
    // Both paragraphs fit in one chunk
    const result = split(input, { chunkSize: 10, chunkStrategy: 'paragraph' })
    expect(result).toEqual([
      {
        chunk: 'A',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 1
      },
      {
        chunk: 'B',
        startIndex: 1,
        startPosition: 3,
        endIndex: 1,
        endPosition: 4
      }
    ])
  })

  test('should cover allUnitsFit branch for sentence', () => {
    const input = 'A. B.'
    // Both sentences fit in one chunk
    const result = split(input, { chunkSize: 10, chunkStrategy: 'sentence' })
    // The actual positions are determined by the regex, which includes trailing whitespace.
    expect(result).toEqual([
      {
        chunk: 'A.',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 3
      },
      {
        chunk: 'B.',
        startIndex: 1,
        startPosition: 3,
        endIndex: 1,
        endPosition: 5
      }
    ])
  })

  test('should handle a single unit larger than chunk size', () => {
    const input = 'ThisIsAVeryLongParagraph'
    // Paragraph is longer than chunkSize, so it should still yield it
    const result = split(input, { chunkSize: 5, chunkStrategy: 'paragraph' })
    expect(result[0].chunk).toBe('ThisIsAVeryLongParagraph')
  })

  test('should cover tempChunks.pop() branch (duplicate chunk removal)', () => {
    // This input/size will create a duplicate chunk at the end
    const input = 'A. B. B.'
    const result = split(input, {
      chunkSize: 5,
      chunkOverlap: 1,
      chunkStrategy: 'sentence'
    })
    // Should not have duplicate chunk at the end
    const chunks = result.map(c => c.chunk)
    expect(new Set(chunks).size).toBe(chunks.length)
  })

  test('should cover lengthFunction branch for character-based chunking', () => {
    const input = 'abcdef'
    // Use a custom lengthFunction to trigger the branch
    const result = split(input, { chunkSize: 2, lengthFunction: t => t.length })
    expect(result[0].chunk).toBe('ab')
  })

  test("should cover the 'break' branch when currentLen > chunkSize in character-based chunking", () => {
    const input = 'abcde'
    // chunkSize 2, so after 'ab', 'c' will be a new chunk
    const result = split(input, { chunkSize: 2 })
    expect(result.map(c => c.chunk)).toEqual(['ab', 'cd', 'e'])
  })

  test("should cover the 'end === start' branch in character-based chunking", () => {
    const input = 'a'
    // chunkSize 0 will force end === start
    const result = split(input, { chunkSize: 0 })
    expect(result[0].chunk).toBe('a')
  })

  test('should cover custom lengthFunction branch for unit-based chunking', () => {
    const input = 'A. B. C. D.'
    // Custom lengthFunction always returns 1, so all units will fit
    const result = split(input, {
      chunkSize: 10,
      chunkStrategy: 'sentence',
      lengthFunction: () => 1
    })
    expect(result.length).toBe(4)
    expect(result.map(c => c.chunk)).toEqual(['A.', 'B.', 'C.', 'D.'])
  })
})

describe('chunkByCharacter', () => {
  it('yields correct chunks for basic input', () => {
    const result = Array.from(chunkByCharacter('abcdef', 2, undefined, 0))
    expect(result).toEqual([
      {
        chunk: 'ab',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 2
      },
      {
        chunk: 'cd',
        startIndex: 2,
        startPosition: 2,
        endIndex: 3,
        endPosition: 4
      },
      {
        chunk: 'ef',
        startIndex: 4,
        startPosition: 4,
        endIndex: 5,
        endPosition: 6
      }
    ])
  })
  it('handles overlap', () => {
    const result = Array.from(chunkByCharacter('abcdef', 3, undefined, 1))
    expect(result).toEqual([
      {
        chunk: 'abc',
        startIndex: 0,
        startPosition: 0,
        endIndex: 2,
        endPosition: 3
      },
      {
        chunk: 'cde',
        startIndex: 2,
        startPosition: 2,
        endIndex: 4,
        endPosition: 5
      },
      {
        chunk: 'ef',
        startIndex: 4,
        startPosition: 4,
        endIndex: 5,
        endPosition: 6
      }
    ])
  })
  it('handles custom lengthFunction', () => {
    const result = Array.from(
      chunkByCharacter('aabbcc', 1, (t: string) => t.length / 2, 0)
    )
    expect(result.length).toBe(3)
  })
  it('handles empty input', () => {
    const result = Array.from(chunkByCharacter('', 2, undefined, 0))
    expect(result).toEqual([])
  })
})

describe('chunkByGreedySlidingWindow', () => {
  it('yields correct chunks for basic input', () => {
    const units = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 2, end: 3 },
      { unit: 'C', start: 4, end: 5 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([
      {
        chunk: 'A B',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 3
      },
      {
        chunk: 'C',
        startIndex: 2,
        startPosition: 4,
        endIndex: 2,
        endPosition: 5
      }
    ])
  })
  it('handles overlap', () => {
    const units = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 2, end: 3 },
      { unit: 'C', start: 4, end: 5 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 1)
    )
    expect(result).toEqual([
      {
        chunk: 'A B',
        startIndex: 0,
        startPosition: 0,
        endIndex: 1,
        endPosition: 3
      },
      {
        chunk: 'B C',
        startIndex: 1,
        startPosition: 2,
        endIndex: 2,
        endPosition: 5
      },
      {
        chunk: 'C',
        startIndex: 2,
        startPosition: 4,
        endIndex: 2,
        endPosition: 5
      }
    ])
  })
  it('handles single unit larger than chunkSize', () => {
    const units = [
      { unit: 'LONGUNIT', start: 0, end: 8 },
      { unit: 'B', start: 9, end: 10 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    ) as any[]
    expect(result[0].chunk).toBe('LONGUNIT')
  })
  it('handles empty input', () => {
    const result = Array.from(
      chunkByGreedySlidingWindow([], undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([])
  })
})
