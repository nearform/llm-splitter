import { chunkByCharacter, chunkByGreedySlidingWindow } from '../src/utils'

describe('chunkByCharacter', () => {
  test('yields correct chunks for basic input', () => {
    const result = Array.from(chunkByCharacter('abcdef', 2, undefined, 0))
    expect(result).toEqual(['ab', 'cd', 'ef'])
  })

  test('handles overlap', () => {
    const result = Array.from(chunkByCharacter('abcdef', 3, undefined, 1))
    expect(result).toEqual(['abc', 'cde', 'ef'])
  })

  test('handles custom lengthFunction', () => {
    const result = Array.from(
      chunkByCharacter('aabbcc', 1, (t: string) => t.length / 2, 0)
    )
    expect(result.length).toBe(3)
  })

  test('handles empty input', () => {
    const result = Array.from(chunkByCharacter('', 2, undefined, 0))
    expect(result).toEqual([])
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
    expect(result).toEqual(['A B', 'C'])
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
    expect(result).toEqual(['A B', 'B C', 'C'])
  })

  test('handles single unit larger than chunkSize', () => {
    const units = [
      { unit: 'LONGUNIT', start: 0, end: 8 },
      { unit: 'B', start: 9, end: 10 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    )
    expect(result[0]).toBe('LONGUNIT')
  })

  test('handles empty input', () => {
    const result = Array.from(
      chunkByGreedySlidingWindow([], undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([])
  })
})
