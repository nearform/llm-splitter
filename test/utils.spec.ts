import { chunkByCharacter, chunkByGreedySlidingWindow } from '../src/utils'

describe('chunkByCharacter', () => {
  test('yields correct chunks for basic input', () => {
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

  test('handles overlap', () => {
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

  test('handles single unit larger than chunkSize', () => {
    const units = [
      { unit: 'LONGUNIT', start: 0, end: 8 },
      { unit: 'B', start: 9, end: 10 }
    ]
    const result = Array.from(
      chunkByGreedySlidingWindow(units, undefined, 1, 3, ' ', 0)
    ) as any[]
    expect(result[0].chunk).toBe('LONGUNIT')
  })

  test('handles empty input', () => {
    const result = Array.from(
      chunkByGreedySlidingWindow([], undefined, 1, 3, ' ', 0)
    )
    expect(result).toEqual([])
  })
})
