import { chunkByCharacter, chunkByGreedySlidingWindow, canFitAllUnits } from '../src/utils'

describe('chunkByCharacter', () => {
  test('yields correct chunks for basic input', () => {
    const result = Array.from(chunkByCharacter('abcdef', 2, undefined, 0))
    expect(result).toEqual([
      { text: 'ab', start: 0, end: 2 },
      { text: 'cd', start: 2, end: 4 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles overlap', () => {
    const result = Array.from(chunkByCharacter('abcdef', 3, undefined, 1))
    expect(result).toEqual([
      { text: 'abc', start: 0, end: 3 },
      { text: 'cde', start: 2, end: 5 },
      { text: 'ef', start: 4, end: 6 }
    ])
  })

  test('handles custom splitter', () => {
    const result = Array.from(
      chunkByCharacter('aabbcc', 1, (t: string) => t.split('').filter((_, i) => i % 2 === 0), 0)
    )
    expect(result.length).toBe(3)
  })

  test('handles empty input', () => {
    const result = Array.from(chunkByCharacter('', 2, undefined, 0))
    expect(result).toEqual([])
  })

  // Test for utils.ts:85 - bestEnd === start case  
  test('handles edge case in chunkByCharacter where bestEnd equals start', () => {
    const result = chunkByCharacter('abc', 0, undefined, 0, 0)
    expect(result.length).toBeGreaterThan(0) // Should still produce at least one chunk
    expect(result[0].text).toBe('a') // Should include at least one character
  })

  // Test for chunkByCharacter should handle case where bestEnd equals start with custom splitter
  it('chunkByCharacter should handle case where bestEnd equals start with custom splitter', () => {
    // Create a splitter that always returns large lengths to force bestEnd === start
    const splitter = (text: string) => new Array(1000).fill('x') // Always large
    const result = chunkByCharacter('abc', 5, splitter, 0, 0)
    expect(result).toHaveLength(3) // Should force one char per chunk
    expect(result[0].text).toBe('a')
    expect(result[1].text).toBe('b')
    expect(result[2].text).toBe('c')
  })
})

describe('chunkByGreedySlidingWindow', () => {
  test('yields correct chunks for basic input', () => {
    const units = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 2, end: 3 },
      { unit: 'C', start: 4, end: 5 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([
      { text: 'A B', start: 0, end: 3 },
      { text: 'C', start: 4, end: 5 }
    ])
  })

  test('handles overlap', () => {
    const units = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 2, end: 3 },
      { unit: 'C', start: 4, end: 5 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 1)
    )
    expect(result).toEqual([
      { text: 'A B', start: 0, end: 3 },
      { text: 'B C', start: 2, end: 5 },
      { text: 'C', start: 4, end: 5 }
    ])
  })

  test('handles single unit larger than chunkSize', () => {
    const units = [
      { unit: 'LONGUNIT', start: 0, end: 8 },
      { unit: 'B', start: 9, end: 10 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    )
    expect(result[0]).toEqual({ text: 'LONGUNIT', start: 0, end: 8 })
  })

  test('handles empty input', () => {
    const result = Array.from(
      chunkByGreedySlidingWindow([], undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([])
  })

  // Test for utils.ts:128 - Force at least one unit per chunk case
  test('handles unit larger than chunk size that forces j++ break', () => {
    const units = [
      { unit: 'VERYLONGUNIT', start: 0, end: 12 },
      { unit: 'short', start: 13, end: 18 }
    ]
    const result = chunkByGreedySlidingWindow(units, undefined, 1, 5, ' ', 0)
    expect(result[0].text).toBe('VERYLONGUNIT') // Should force inclusion even if too large
    expect(result.length).toBeGreaterThan(0)
  })

  // Additional test for utils.ts:128 - j === i branch with custom splitter
  test('handles large unit with custom splitter that forces break', () => {
    const units = [
      { unit: 'verylongword', start: 0, end: 12 }
    ]
    const charSplitter = (text: string) => text.split('')
    // Unit has 12 characters, chunk size is 5, should force j++ break
    const result = chunkByGreedySlidingWindow(units, charSplitter, 0, 5, '', 0)
    expect(result[0].text).toBe('verylongword') // Should be included despite being too large
  })
})

describe('canFitAllUnits', () => {
  // Test for utils.ts:40-43 - canFitAllUnits failure case
  test('should return false when units do not fit within chunk size', () => {
    const units = [
      { unit: 'verylongtext', start: 0, end: 12 },
      { unit: 'anotherlongtext', start: 13, end: 27 }
    ]
    const result = canFitAllUnits(units, undefined, 5, 1) // Very small chunk size
    expect(result).toBe(false)
  })

  test('should return true when units fit within chunk size', () => {
    const units = [
      { unit: 'a', start: 0, end: 1 },
      { unit: 'b', start: 2, end: 3 }
    ]
    const result = canFitAllUnits(units, undefined, 10, 1)
    expect(result).toBe(true)
  })

  test('should handle custom splitter in canFitAllUnits', () => {
    const units = [
      { unit: 'hello world', start: 0, end: 11 }
    ]
    const wordSplitter = (text: string) => text.split(/\s+/)
    const result = canFitAllUnits(units, wordSplitter, 1, 0) // Only 1 word allowed
    expect(result).toBe(false) // 'hello world' has 2 words
  })

  test('should handle case where individual units fit but total exceeds chunk size', () => {
    const units = [
      { unit: 'a', start: 0, end: 1 },
      { unit: 'b', start: 2, end: 3 },
      { unit: 'c', start: 4, end: 5 }
    ]
    // Each unit is 1 char (fits), but total with joiners is 3 + 2 = 5, which exceeds chunk size 4
    const result = canFitAllUnits(units, undefined, 4, 1) // joinerLen = 1
    expect(result).toBe(false)
  })

  test('should handle splitter in reduce accumulator case', () => {
    const units = [
      { unit: 'hello', start: 0, end: 5 },
      { unit: 'world', start: 6, end: 11 }
    ]
    const charSplitter = (text: string) => text.split('')
    // Each word: 5 chars, total: 10 + 1 joiner = 11, which exceeds chunk size 10
    const result = canFitAllUnits(units, charSplitter, 10, 1)
    expect(result).toBe(false)
  })
})
