import { chunkByCharacter, chunkByGreedySlidingWindow } from '../src/utils'

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
})
