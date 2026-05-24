import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getChunk } from '../src/index.js'

describe('getChunk', () => {
  describe('string input', () => {
    it('should extract a substring from a single string', () => {
      const result = getChunk('hello world', 0, 5)
      assert.strictEqual(result, 'hello')
    })

    it('should extract a substring from the middle of a string', () => {
      const result = getChunk('hello world', 6, 11)
      assert.strictEqual(result, 'world')
    })

    it('should handle empty string', () => {
      const result = getChunk('', 0, 0)
      assert.strictEqual(result, '')
    })

    it('should handle start and end at same position', () => {
      const result = getChunk('hello', 2, 2)
      assert.strictEqual(result, '')
    })

    it('should handle start beyond string length', () => {
      const result = getChunk('hello', 10, 15)
      assert.strictEqual(result, '')
    })

    it('should handle end beyond string length', () => {
      const result = getChunk('hello', 0, 10)
      assert.strictEqual(result, 'hello')
    })

    it('should handle negative start', () => {
      const result = getChunk('hello', -2, 3)
      assert.strictEqual(result, 'hel')
    })

    it('should handle negative end', () => {
      const result = getChunk('hello', 0, -2)
      assert.strictEqual(result, '')
    })
  })

  describe('array input', () => {
    it('should extract chunk from single array element', () => {
      const result = getChunk(['hello world'], 0, 5)
      assert.deepStrictEqual(result, ['hello'])
    })

    it('should extract chunk spanning multiple array elements', () => {
      const result = getChunk(['hello', ' world'], 3, 8)
      assert.deepStrictEqual(result, ['lo', ' wo'])
    })

    it('should extract chunk from middle of array elements', () => {
      const result = getChunk(['hello', 'world', 'test'], 5, 10)
      assert.deepStrictEqual(result, ['world'])
    })

    it('should handle partial first element', () => {
      const result = getChunk(['hello', 'world'], 3, 10)
      assert.deepStrictEqual(result, ['lo', 'world'])
    })

    it('should handle partial last element', () => {
      const result = getChunk(['hello', 'world'], 0, 7)
      assert.deepStrictEqual(result, ['hello', 'wo'])
    })

    it('should handle empty array', () => {
      const result = getChunk([], 0, 5)
      assert.deepStrictEqual(result, [])
    })

    it('should handle array with empty strings', () => {
      const result = getChunk(['', 'hello', '', 'world'], 0, 10)

      // Note: The unmatched empty string in between is included.
      assert.deepStrictEqual(result, ['hello', '', 'world'])
    })

    it('should handle start beyond total length', () => {
      const result = getChunk(['hello', 'world'], 20, 25)
      assert.deepStrictEqual(result, [])
    })

    it('should handle end beyond total length', () => {
      const result = getChunk(['hello', 'world'], 0, 20)
      assert.deepStrictEqual(result, ['hello', 'world'])
    })

    it('should handle start and end at same position', () => {
      const result = getChunk(['hello', 'world'], 5, 5)
      assert.deepStrictEqual(result, [])
    })

    it('should handle chunk starting in middle of first element', () => {
      const result = getChunk(['hello', 'world'], 2, 7)
      assert.deepStrictEqual(result, ['llo', 'wo'])
    })

    it('should handle chunk ending in middle of last element', () => {
      const result = getChunk(['hello', 'world'], 0, 8)
      assert.deepStrictEqual(result, ['hello', 'wor'])
    })

    it('should handle single character elements', () => {
      const result = getChunk(['a', 'b', 'c', 'd'], 1, 3)
      assert.deepStrictEqual(result, ['b', 'c'])
    })

    it('should handle chunk spanning all elements', () => {
      const result = getChunk(['hello', ' ', 'world'], 0, 11)
      assert.deepStrictEqual(result, ['hello', ' ', 'world'])
    })

    it('should handle chunk within single element of multi-element array', () => {
      const result = getChunk(['hello', 'world', 'test'], 6, 9)
      assert.deepStrictEqual(result, ['orl'])
    })
  })

  describe('edge cases', () => {
    it('should handle null input gracefully', () => {
      // @ts-expect-error test
      assert.throws(() => getChunk(null, 0, 5), TypeError)
    })

    it('should handle undefined input gracefully', () => {
      // @ts-expect-error test
      assert.throws(() => getChunk(undefined, 0, 5), TypeError)
    })

    it('should handle non-string array elements', () => {
      // @ts-expect-error test
      assert.throws(() => getChunk(['hello', 123, 'world'], 0, 5), TypeError)
    })

    it('should handle very large start/end values', () => {
      const result = getChunk(
        'hello',
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER
      )
      assert.strictEqual(result, '')
    })

    it('should handle zero length strings in array', () => {
      const result = getChunk(['', '', ''], 0, 0)
      assert.deepStrictEqual(result, [])

      const result2 = getChunk(['', '', ''], 1, 3)
      assert.deepStrictEqual(result2, [])
    })

    it('should handle chunk that starts and ends within same array element', () => {
      const result = getChunk(['hello', 'world'], 1, 4)
      assert.deepStrictEqual(result, ['ell'])
    })
  })
})
