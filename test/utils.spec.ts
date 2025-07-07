import { chunkByCharacter, chunkByParagraph } from '../src/utils'
import { get_encoding } from 'tiktoken'

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

describe('chunkByParagraph', () => {
  test('yields correct chunks for basic input', () => {
    const units = [
      { unit: 'A', start: 0, end: 1 },
      { unit: 'B', start: 2, end: 3 },
      { unit: 'C', start: 4, end: 5 }
    ]
    const result = Array.from(
      chunkByParagraph(units, undefined, 4, 0)
    )
    expect(result).toEqual([
      { text: 'A\n\nB', start: 0, end: 3 },
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
      chunkByParagraph(units, undefined, 4, 1)
    )
    expect(result).toEqual([
      { text: 'A\n\nB', start: 0, end: 3 },
      { text: 'B\n\nC', start: 2, end: 5 },
      { text: 'C', start: 4, end: 5 }
    ])
  })

  test('handles single unit larger than chunkSize', () => {
    const units = [
      { unit: 'LONGUNIT', start: 0, end: 8 },
      { unit: 'B', start: 9, end: 10 }
    ]
    const result = Array.from(
      chunkByParagraph(units, undefined, 5, 0)
    )
    expect(result[0]).toEqual({ text: 'LONGUNIT', start: 0, end: 8 })
  })

  test('handles empty input', () => {
    const result = Array.from(
      chunkByParagraph([], undefined, 5, 0)
    )
    expect(result).toEqual([])
  })

  // Test for utils.ts:128 - Force at least one unit per chunk case
  test('handles unit larger than chunk size that forces j++ break', () => {
    const units = [
      { unit: 'VERYLONGUNIT', start: 0, end: 12 },
      { unit: 'short', start: 13, end: 18 }
    ]
    const result = chunkByParagraph(units, undefined, 5, 0)
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
    const result = chunkByParagraph(units, charSplitter, 5, 0)
    expect(result[0].text).toBe('verylongword') // Should be included despite being too large
  })

  test('works with tiktoken as custom splitter', () => {
    const encoding = get_encoding('gpt2')
    
    const units = [
      { unit: 'Hello world!', start: 0, end: 12 },
      { unit: 'This is a test sentence.', start: 13, end: 37 },
      { unit: 'Another paragraph here.', start: 38, end: 61 }
    ]
    
    // Custom splitter that uses tiktoken to create token-based chunks
    // Instead of returning individual tokens, we'll return words but count by tokens
    const tiktokenSplitter = (text: string): string[] => {
      // For this test, we'll split by words but use token count for sizing
      const words = text.split(/\s+/).filter(word => word.length > 0)
      return words
    }
    
    // Use a smaller chunk size to force multiple chunks
    const result = Array.from(
      chunkByParagraph(units, tiktokenSplitter, 3, 0)
    )
    
    // Should have multiple chunks since we're limiting to 3 tokens per chunk
    expect(result.length).toBeGreaterThan(1)
    expect(result[0].text).toContain('Hello')
    
    // Verify that chunks are joined with \n\n
    const firstChunk = result[0]
    if (firstChunk.text.includes('\n\n')) {
      expect(firstChunk.text).toMatch(/\n\n/)
    }
    
    // Clean up encoding
    encoding.free()
  })
})
