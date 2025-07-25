/* global TextDecoder:false */
import { describe, it, after, before } from 'node:test'
import assert from 'node:assert'
import tiktoken, { type Tiktoken } from 'tiktoken'
import { splitToParts, split, ChunkStrategy, type Chunk } from '../src/split.js'

// Helpers
const charSplitter = (text: string): string[] => [...text]
const whitespaceSplitter = (text: string): string[] => text.split(/\s+/)

const td = new TextDecoder()
const tokenSplitter = (text: string): string[] =>
  Array.from(tokenizer.encode(text)).map(token =>
    td.decode(tokenizer.decode([token] as any))
  )

// Tests
let tokenizer: Tiktoken
describe('split', () => {
  before(() => {
    tokenizer = tiktoken.encoding_for_model('text-embedding-ada-002')
  })

  after(() => {
    tokenizer.free()
  })

  describe('splitToParts', () => {
    it('should yield nothing for empty input array', () => {
      const input: string[] = []
      const expected: Chunk[] = []
      const result: Chunk[] = splitToParts(input, charSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split with default splitter (char split)', () => {
      const input: string[] = ['hello world!']
      const expected: Chunk[] = [
        { text: 'h', start: 0, end: 1 },
        { text: 'e', start: 1, end: 2 },
        { text: 'l', start: 2, end: 3 },
        { text: 'l', start: 3, end: 4 },
        { text: 'o', start: 4, end: 5 },
        { text: ' ', start: 5, end: 6 },
        { text: 'w', start: 6, end: 7 },
        { text: 'o', start: 7, end: 8 },
        { text: 'r', start: 8, end: 9 },
        { text: 'l', start: 9, end: 10 },
        { text: 'd', start: 10, end: 11 },
        { text: '!', start: 11, end: 12 }
      ]
      const result: Chunk[] = splitToParts(input, charSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split with whitespace splitter', () => {
      const input: string[] = ['hello world!']
      const expected: Chunk[] = [
        { text: 'hello', start: 0, end: 5 },
        { text: 'world!', start: 6, end: 12 }
      ]
      const result: Chunk[] = splitToParts(input, whitespaceSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split with tiktoken splitter', () => {
      const input: string[] = ['hello world! ']
      const expected: Chunk[] = [
        { text: 'hello', start: 0, end: 5 },
        { text: ' world', start: 5, end: 11 },
        { text: '!', start: 11, end: 12 },
        { text: ' ', start: 12, end: 13 }
      ]
      const result: Chunk[] = splitToParts(input, tokenSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split multiple items with default splitter', () => {
      const input: string[] = ['foo bar', 'baz! qux']
      const expected: Chunk[] = [
        { text: 'f', start: 0, end: 1 },
        { text: 'o', start: 1, end: 2 },
        { text: 'o', start: 2, end: 3 },
        { text: ' ', start: 3, end: 4 },
        { text: 'b', start: 4, end: 5 },
        { text: 'a', start: 5, end: 6 },
        { text: 'r', start: 6, end: 7 },
        { text: 'b', start: 7, end: 8 },
        { text: 'a', start: 8, end: 9 },
        { text: 'z', start: 9, end: 10 },
        { text: '!', start: 10, end: 11 },
        { text: ' ', start: 11, end: 12 },
        { text: 'q', start: 12, end: 13 },
        { text: 'u', start: 13, end: 14 },
        { text: 'x', start: 14, end: 15 }
      ]
      const result: Chunk[] = splitToParts(input, charSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split multiple items with whitespace splitter', () => {
      const input: string[] = [' 123 567', '89z! qux ']
      const expected: Chunk[] = [
        { text: '123', start: 1, end: 4 },
        { text: '567', start: 5, end: 8 },
        { text: '89z!', start: 8, end: 12 },
        { text: 'qux', start: 13, end: 16 }
      ]

      let result = splitToParts(input, whitespaceSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('should split multiple items with tiktoken splitter', () => {
      const input: string[] = ['foo bar', 'baz! qux']
      const expected: Chunk[] = [
        { text: 'foo', start: 0, end: 3 },
        { text: ' bar', start: 3, end: 7 },
        { text: 'baz', start: 7, end: 10 },
        { text: '!', start: 10, end: 11 },
        { text: ' qu', start: 11, end: 14 },
        { text: 'x', start: 14, end: 15 }
      ]
      const result: Chunk[] = splitToParts(input, tokenSplitter)

      assert.deepStrictEqual(result, expected)
    })

    it('throws if splitter returns non string outputs', async () => {
      const inputs: string[] = ['hello']
      const splitter = (): unknown[] => [400, 1, 2, 3, 4]
      await assert.rejects(
        async () => {
          // @ts-expect-error
          splitToParts(inputs, splitter)
        },
        {
          message: 'Splitter returned a non-string part: 400 for input: hello'
        }
      )
    })

    it('throws if splitter returns a part not found in input', async () => {
      const inputs: string[] = ['hello']
      const splitter = (): string[] => ['notfound']
      await assert.rejects(
        async () => {
          splitToParts(inputs, splitter)
        },
        {
          message:
            'Splitter did not return any parts for input (5): "hello"... with part (8): "notfound"...'
        }
      )
    })

    it('throws if splitter returns a part that only partially matches', async () => {
      const inputs: string[] = ['abc']
      const splitter = (): string[] => ['a', 'z']
      await assert.rejects(
        async () => {
          splitToParts(inputs, splitter)
        },
        {
          message:
            'Splitter did not return any parts for input (3): "abc"... with part (1): "z"...'
        }
      )
    })

    it('does not throw if all parts are found', async () => {
      const inputs: string[] = ['abc']
      const splitter = (): string[] => ['a', 'b', 'c']
      assert.doesNotReject(async () => {
        splitToParts(inputs, splitter)
      })
    })
  })

  describe('split', () => {
    describe('basics', () => {
      it('should split array with whitespace splitter and extra whitespace', () => {
        const input: string[] = [
          ' hello world! ',
          'This is the split test string. Of words. ',
          ' '
        ]
        const result: Chunk[] = split(input, {
          chunkSize: 5,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello world! ', 'This is the'], start: 1, end: 25 },
          { text: ['split test string. Of words.'], start: 26, end: 54 }
        ])
      })

      // Base cases
      it('should handle empty string input', () => {
        const input: string = ''
        const result: Chunk[] = split(input)
        assert.deepStrictEqual(result, [])
      })

      it('should handle empty array input', () => {
        const input: string[] = []
        const result: Chunk[] = split(input)
        assert.deepStrictEqual(result, [])
      })

      it('should handle array with empty strings', () => {
        const input: string[] = ['', '', '']
        const result: Chunk[] = split(input)
        assert.deepStrictEqual(result, [])
      })

      it('should handle single character with default splitter', () => {
        const input: string = 'a'
        const result: Chunk[] = split(input, { chunkSize: 1 })
        assert.deepStrictEqual(result, [{ text: 'a', start: 0, end: 1 }])
      })

      it('should handle single word with default splitter', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 3 })
        assert.deepStrictEqual(result, [
          { text: 'hel', start: 0, end: 3 },
          { text: 'lo', start: 3, end: 5 }
        ])
      })

      // Parameter permutations
      it('should use default chunkSize when not specified', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input)
        // Default chunkSize is 512, so all text should be in one chunk
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 }
        ])
      })

      it('should use default splitter when not specified', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 1 })
        // Default splitter is char split
        assert.deepStrictEqual(result, [
          { text: 'h', start: 0, end: 1 },
          { text: 'e', start: 1, end: 2 },
          { text: 'l', start: 2, end: 3 },
          { text: 'l', start: 3, end: 4 },
          { text: 'o', start: 4, end: 5 }
        ])
      })

      it('should handle chunkSize larger than input', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 10 })
        assert.deepStrictEqual(result, [{ text: 'hello', start: 0, end: 5 }])
      })

      it('should handle chunkSize equal to input length', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 5 })
        assert.deepStrictEqual(result, [{ text: 'hello', start: 0, end: 5 }])
      })

      it('should handle chunkSize smaller than input length', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, { chunkSize: 3 })
        assert.deepStrictEqual(result, [
          { text: 'hel', start: 0, end: 3 },
          { text: 'lo ', start: 3, end: 6 },
          { text: 'wor', start: 6, end: 9 },
          { text: 'ld', start: 9, end: 11 }
        ])
      })

      // Different input types
      it('should handle string input with whitespace splitter', () => {
        const input: string = 'hello world test'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 },
          { text: 'test', start: 12, end: 16 }
        ])
      })

      it('should handle array input with whitespace splitter', () => {
        const input: string[] = ['hello world', 'test string']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello world'], start: 0, end: 11 },
          { text: ['test string'], start: 11, end: 22 }
        ])
      })

      it('should handle array with single string', () => {
        const input: string[] = ['hello world']
        const result: Chunk[] = split(input, {
          chunkSize: 3,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello world'], start: 0, end: 11 }
        ])
      })

      it('should handle array with multiple strings', () => {
        const input: string[] = ['hello', 'world', 'test']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: charSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['he'], start: 0, end: 2 },
          { text: ['ll'], start: 2, end: 4 },
          { text: ['o', 'w'], start: 4, end: 6 },
          { text: ['or'], start: 6, end: 8 },
          { text: ['ld'], start: 8, end: 10 },
          { text: ['te'], start: 10, end: 12 },
          { text: ['st'], start: 12, end: 14 }
        ])
      })

      // Edge cases
      it('should handle input with only whitespace', () => {
        const input: string = '   '
        const result: Chunk[] = split(input, {
          chunkSize: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [])
      })

      it('should handle input with only whitespace in array', () => {
        const input: string[] = ['   ', '  ']
        const result: Chunk[] = split(input, {
          chunkSize: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [])
      })

      it('should handle chunkSize of 1', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 1 })
        assert.deepStrictEqual(result, [
          { text: 'h', start: 0, end: 1 },
          { text: 'e', start: 1, end: 2 },
          { text: 'l', start: 2, end: 3 },
          { text: 'l', start: 3, end: 4 },
          { text: 'o', start: 4, end: 5 }
        ])
      })

      it('should throw error for chunkSize of 0', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 0 })
          },
          {
            name: 'Error',
            message: 'Chunk size must be at least 1'
          }
        )
      })

      // Validation tests
      it('should throw error for negative chunkSize', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: -1 })
          },
          {
            name: 'Error',
            message: 'Chunk size must be at least 1'
          }
        )
      })

      it('should throw error for non-integer chunkSize', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 1.5 })
          },
          {
            name: 'Error',
            message: 'Chunk size must be a positive integer'
          }
        )
      })

      it('should throw error for non-number chunkSize', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 'invalid' as any })
          },
          {
            name: 'Error',
            message: 'Chunk size must be a positive integer'
          }
        )
      })

      it('should throw error for negative chunkOverlap', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 5, chunkOverlap: -1 })
          },
          {
            name: 'Error',
            message: 'Chunk overlap must be at least 0'
          }
        )
      })

      it('should throw error for non-integer chunkOverlap', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 5, chunkOverlap: 1.5 })
          },
          {
            name: 'Error',
            message: 'Chunk overlap must be a non-negative integer. Found: 1.5'
          }
        )
      })

      it('should throw error for non-number chunkOverlap', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 5, chunkOverlap: 'invalid' as any })
          },
          {
            name: 'Error',
            message:
              'Chunk overlap must be a non-negative integer. Found: invalid'
          }
        )
      })

      it('should throw error when chunkOverlap >= chunkSize', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 5, chunkOverlap: 5 })
          },
          {
            name: 'Error',
            message: 'Chunk overlap must be less than chunk size'
          }
        )
      })

      it('should throw error when chunkOverlap > chunkSize', async () => {
        const input: string = 'hello'
        await assert.rejects(
          async () => {
            split(input, { chunkSize: 3, chunkOverlap: 5 })
          },
          {
            name: 'Error',
            message: 'Chunk overlap must be less than chunk size'
          }
        )
      })

      // Token splitter tests
      it('should handle string input with token splitter', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: tokenSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 }
        ])
      })

      it('should handle array input with token splitter', () => {
        const input: string[] = [
          'hello',
          'world',
          'bar baz buz',
          'what? why? howdymachina'
        ]
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: tokenSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello', 'world'], start: 0, end: 10 },
          { text: ['bar baz'], start: 10, end: 17 },
          { text: [' buz', 'what'], start: 17, end: 25 },
          { text: ['? why'], start: 25, end: 30 },
          { text: ['? how'], start: 30, end: 35 },
          { text: ['dym'], start: 35, end: 38 },
          { text: ['achina'], start: 38, end: 44 }
        ])
      })

      // Complex scenarios
      it('should handle mixed content with whitespace splitter', () => {
        const input: string = 'hello   world!  test'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello   world!', start: 0, end: 14 },
          { text: 'test', start: 16, end: 20 }
        ])
      })

      it('should handle array with mixed content', () => {
        const input: string[] = ['hello', '   world!', 'test']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello', '   world!'], start: 0, end: 14 },
          { text: ['test'], start: 14, end: 18 }
        ])
      })

      it('should handle very large chunkSize', () => {
        const input: string = 'hello world test string'
        const result: Chunk[] = split(input, { chunkSize: 1000 })
        assert.deepStrictEqual(result, [
          { text: 'hello world test string', start: 0, end: 23 }
        ])
      })

      it('should handle array boundary as token boundary', () => {
        const input: string[] = ['hello', 'world']
        const result: Chunk[] = split(input, {
          chunkSize: 3,
          splitter: charSplitter
        })
        // Should respect array boundaries
        assert.deepStrictEqual(result, [
          { text: ['hel'], start: 0, end: 3 },
          { text: ['lo', 'w'], start: 3, end: 6 },
          { text: ['orl'], start: 6, end: 9 },
          { text: ['d'], start: 9, end: 10 }
        ])
      })
    })

    describe('chunkOverlap', () => {
      // Basic overlap tests with char splitter
      it('should handle chunkOverlap of 1 with char splitter', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 1 })
        assert.deepStrictEqual(result, [
          { text: 'hel', start: 0, end: 3 },
          { text: 'llo', start: 2, end: 5 },
          { text: 'o w', start: 4, end: 7 },
          { text: 'wor', start: 6, end: 9 },
          { text: 'rld', start: 8, end: 11 }
        ])
      })

      it('should handle chunkOverlap of 2 with char splitter', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, { chunkSize: 4, chunkOverlap: 2 })
        assert.deepStrictEqual(result, [
          { text: 'hell', start: 0, end: 4 },
          { text: 'llo ', start: 2, end: 6 },
          { text: 'o wo', start: 4, end: 8 },
          { text: 'worl', start: 6, end: 10 },
          { text: 'rld', start: 8, end: 11 }
        ])
      })

      it('should handle chunkOverlap equal to chunkSize - 1', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 2 })
        assert.deepStrictEqual(result, [
          { text: 'hel', start: 0, end: 3 },
          { text: 'ell', start: 1, end: 4 },
          { text: 'llo', start: 2, end: 5 },
          { text: 'lo ', start: 3, end: 6 },
          { text: 'o w', start: 4, end: 7 },
          { text: ' wo', start: 5, end: 8 },
          { text: 'wor', start: 6, end: 9 },
          { text: 'orl', start: 7, end: 10 },
          { text: 'rld', start: 8, end: 11 }
        ])
      })

      // Overlap with whitespace splitter
      it('should handle chunkOverlap with whitespace splitter', () => {
        const input: string = 'hello world test string'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 },
          { text: 'world test', start: 6, end: 16 },
          { text: 'test string', start: 12, end: 23 }
        ])
      })

      it('should handle chunkOverlap with whitespace splitter and multiple spaces', () => {
        const input: string = 'hello   world  test'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello   world', start: 0, end: 13 },
          { text: 'world  test', start: 8, end: 19 }
        ])
      })

      // Overlap with array inputs
      it('should handle chunkOverlap with array input and char splitter', () => {
        const input: string[] = ['hello', 'world']
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 1 })
        assert.deepStrictEqual(result, [
          { text: ['hel'], start: 0, end: 3 },
          { text: ['llo'], start: 2, end: 5 },
          { text: ['o', 'wo'], start: 4, end: 7 },
          { text: ['orl'], start: 6, end: 9 },
          { text: ['ld'], start: 8, end: 10 }
        ])
      })

      it('should handle chunkOverlap with array input and whitespace splitter', () => {
        const input: string[] = ['hello world', 'test string']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello world'], start: 0, end: 11 },
          { text: ['world', 'test'], start: 6, end: 15 },
          { text: ['test string'], start: 11, end: 22 }
        ])
      })

      // Edge cases for overlap
      it('should handle chunkOverlap of 0 (default behavior)', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 0 })
        assert.deepStrictEqual(result, [
          { text: 'hel', start: 0, end: 3 },
          { text: 'lo ', start: 3, end: 6 },
          { text: 'wor', start: 6, end: 9 },
          { text: 'ld', start: 9, end: 11 }
        ])
      })

      it('should handle chunkOverlap with input smaller than chunkSize', () => {
        const input: string = 'hi'
        const result: Chunk[] = split(input, { chunkSize: 5, chunkOverlap: 2 })
        assert.deepStrictEqual(result, [{ text: 'hi', start: 0, end: 2 }])
      })

      it('should handle chunkOverlap with input equal to chunkSize', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 5, chunkOverlap: 2 })
        assert.deepStrictEqual(result, [{ text: 'hello', start: 0, end: 5 }])
      })

      it('should handle chunkOverlap with single character input', () => {
        const input: string = 'a'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 1 })
        assert.deepStrictEqual(result, [{ text: 'a', start: 0, end: 1 }])
      })

      // Complex overlap scenarios
      it('should handle large chunkOverlap with small chunkSize', () => {
        const input: string = 'abcdefghij'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 2 })
        assert.deepStrictEqual(result, [
          { text: 'abc', start: 0, end: 3 },
          { text: 'bcd', start: 1, end: 4 },
          { text: 'cde', start: 2, end: 5 },
          { text: 'def', start: 3, end: 6 },
          { text: 'efg', start: 4, end: 7 },
          { text: 'fgh', start: 5, end: 8 },
          { text: 'ghi', start: 6, end: 9 },
          { text: 'hij', start: 7, end: 10 }
        ])
      })

      it('should handle chunkOverlap with whitespace-only input', () => {
        const input: string = '   '
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [])
      })

      it('should handle chunkOverlap with array containing empty strings', () => {
        const input: string[] = ['', 'hello', '']
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 1 })
        assert.deepStrictEqual(result, [
          { text: ['hel'], start: 0, end: 3 },
          { text: ['llo'], start: 2, end: 5 }
        ])
      })

      // Token splitter overlap tests
      it('should handle chunkOverlap with token splitter', () => {
        const input: string = 'hello world test'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: tokenSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 },
          { text: ' world test', start: 5, end: 16 }
        ])
      })

      it('should handle chunkOverlap with token splitter and array input', () => {
        const input: string[] = ['hello', 'world']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: tokenSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello', 'world'], start: 0, end: 10 }
        ])
      })

      // Boundary conditions
      it('should handle chunkOverlap with chunkSize of 1', () => {
        const input: string = 'hello'
        const result: Chunk[] = split(input, { chunkSize: 1, chunkOverlap: 0 })
        assert.deepStrictEqual(result, [
          { text: 'h', start: 0, end: 1 },
          { text: 'e', start: 1, end: 2 },
          { text: 'l', start: 2, end: 3 },
          { text: 'l', start: 3, end: 4 },
          { text: 'o', start: 4, end: 5 }
        ])
      })

      it('should handle chunkOverlap with very large chunkSize', () => {
        const input: string = 'hello world'
        const result: Chunk[] = split(input, {
          chunkSize: 100,
          chunkOverlap: 10
        })
        assert.deepStrictEqual(result, [
          { text: 'hello world', start: 0, end: 11 }
        ])
      })

      // Mixed content scenarios
      it('should handle chunkOverlap with mixed content and whitespace splitter', () => {
        const input: string = 'hello   world!  test'
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello   world!', start: 0, end: 14 },
          { text: 'world!  test', start: 8, end: 20 }
        ])
      })

      it('should handle chunkOverlap with array containing mixed content', () => {
        const input: string[] = ['hello', '   world!', 'test']
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: ['hello', '   world!'], start: 0, end: 14 },
          { text: ['world!', 'test'], start: 8, end: 18 }
        ])
      })

      // Overlap behavior verification
      it('should verify overlap parts are correctly carried forward', () => {
        const input: string = 'abcdefghijklmnop'
        const result: Chunk[] = split(input, { chunkSize: 4, chunkOverlap: 2 })
        // Verify that each chunk (except first) starts with the last 2 chars of previous chunk
        for (let i = 1; i < result.length; i++) {
          const prevChunk = result[i - 1]
          const currChunk = result[i]
          const prevText = prevChunk.text as string
          const currText = currChunk.text as string

          // The current chunk should start with the last 2 characters of the previous chunk
          assert.strictEqual(
            currText.substring(0, 2),
            prevText.substring(prevText.length - 2),
            `Chunk ${i} should start with last 2 chars of chunk ${i - 1}`
          )
        }
      })

      it('should handle chunkOverlap with unicode characters', () => {
        const input: string = 'héllö wörld'
        const result: Chunk[] = split(input, { chunkSize: 3, chunkOverlap: 1 })
        assert.deepStrictEqual(result, [
          { text: 'hél', start: 0, end: 3 },
          { text: 'llö', start: 2, end: 5 },
          { text: 'ö w', start: 4, end: 7 },
          { text: 'wör', start: 6, end: 9 },
          { text: 'rld', start: 8, end: 11 }
        ])
      })

      // Stress tests
      it('should handle chunkOverlap with very small chunkSize and large overlap', () => {
        const input: string = 'abcdefghijklmnopqrstuvwxyz'
        const result: Chunk[] = split(input, { chunkSize: 2, chunkOverlap: 1 })
        // Should have many overlapping chunks
        assert(result.length > 10)
        // Each chunk should have exactly 2 characters
        for (const chunk of result) {
          assert.strictEqual((chunk.text as string).length, 2)
        }
      })

      it('should handle chunkOverlap with whitespace splitter and complex spacing', () => {
        const input: string = '  hello   world  test  string  '
        const result: Chunk[] = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter
        })
        assert.deepStrictEqual(result, [
          { text: 'hello   world', start: 2, end: 15 },
          { text: 'world  test', start: 10, end: 21 },
          { text: 'test  string', start: 17, end: 29 }
        ])
      })
    })

    describe('chunkStrategy', () => {
      describe('validation', () => {
        it('should throw error for invalid chunkStrategy', async () => {
          const input: string = 'hello world'
          await assert.rejects(
            async () => {
              split(input, { chunkSize: 5, chunkStrategy: 'invalid' as any })
            },
            {
              name: 'Error',
              message:
                'Invalid chunk strategy. Must be one of: character, paragraph'
            }
          )
        })

        it('should accept character chunkStrategy', () => {
          const input: string = 'hello world'
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'character'
          })
          assert.deepStrictEqual(result, [
            { text: 'hel', start: 0, end: 3 },
            { text: 'lo ', start: 3, end: 6 },
            { text: 'wor', start: 6, end: 9 },
            { text: 'ld', start: 9, end: 11 }
          ])
        })

        it('should accept paragraph chunkStrategy', () => {
          const input: string = 'hello\n\nworld'
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'paragraph'
          })
          assert.deepStrictEqual(result, [
            { text: 'hel', start: 0, end: 3 },
            { text: 'lo', start: 3, end: 5 },
            { text: 'wor', start: 7, end: 10 },
            { text: 'ld', start: 10, end: 12 }
          ])
        })
      })

      // Character strategy tests (default behavior)
      describe('character strategy', () => {
        it('should behave like default behavior when chunkStrategy is character', () => {
          const input: string = 'hello world'
          const result1 = split(input, { chunkSize: 3 })
          const result2 = split(input, {
            chunkSize: 3,
            chunkStrategy: 'character'
          })
          assert.deepStrictEqual(result1, result2)
        })

        it('should handle character strategy with whitespace splitter', () => {
          const input: string = 'hello world test'
          const result: Chunk[] = split(input, {
            chunkSize: 2,
            chunkStrategy: 'character',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello world', start: 0, end: 11 },
            { text: 'test', start: 12, end: 16 }
          ])
        })

        it('should handle character strategy with array input', () => {
          const input: string[] = ['hello', 'world']
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'character',
            splitter: charSplitter
          })
          assert.deepStrictEqual(result, [
            { text: ['hel'], start: 0, end: 3 },
            { text: ['lo', 'w'], start: 3, end: 6 },
            { text: ['orl'], start: 6, end: 9 },
            { text: ['d'], start: 9, end: 10 }
          ])
        })

        it('should handle character strategy with chunkOverlap', () => {
          const input: string = 'hello world'
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkOverlap: 1,
            chunkStrategy: 'character'
          })
          assert.deepStrictEqual(result, [
            { text: 'hel', start: 0, end: 3 },
            { text: 'llo', start: 2, end: 5 },
            { text: 'o w', start: 4, end: 7 },
            { text: 'wor', start: 6, end: 9 },
            { text: 'rld', start: 8, end: 11 }
          ])
        })
      })

      // Paragraph strategy tests
      describe('paragraph strategy', () => {
        it('should group tokens by paragraphs', () => {
          const input: string = 'hello\n\nworld\n\ntest'
          const result: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello', start: 0, end: 5 },
            { text: 'world', start: 7, end: 12 },
            { text: 'test', start: 14, end: 18 }
          ])
        })

        it('should handle single paragraph that fits in chunk', () => {
          const input: string = 'hello world'
          const result: Chunk[] = split(input, {
            chunkSize: 5,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello world', start: 0, end: 11 }
          ])
        })

        it('should handle paragraph that exceeds chunk size', () => {
          const input: string = 'hello world test string'
          const result: Chunk[] = split(input, {
            chunkSize: 2,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          // Should split across multiple chunks since paragraph is too large
          assert.deepStrictEqual(result, [
            { text: 'hello world', start: 0, end: 11 },
            { text: 'test string', start: 12, end: 23 }
          ])
        })

        it('should handle multiple paragraphs with mixed sizes', () => {
          const input: string =
            'short\n\nvery long paragraph with many words\n\nanother short'
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'short', start: 0, end: 5 },
            { text: 'very long paragraph', start: 7, end: 26 },
            { text: 'with many words', start: 27, end: 42 },
            { text: 'another short', start: 44, end: 57 }
          ])
        })

        it('should handle empty paragraphs', () => {
          const input: string = 'hello\n\n\n\nworld'
          const result: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello', start: 0, end: 5 },
            { text: 'world', start: 9, end: 14 }
          ])
        })

        it('should handle paragraphs with only whitespace', () => {
          const input: string = 'hello\n\n   \n\nworld'
          const result: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello', start: 0, end: 5 },
            { text: 'world', start: 12, end: 17 }
          ])
        })

        it('should handle array input with paragraph strategy', () => {
          const input: string[] = ['hello\n\nworld', 'test\n\nstring']
          const result: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: ['hello'], start: 0, end: 5 },
            { text: ['world'], start: 7, end: 12 },
            { text: ['test'], start: 12, end: 16 },
            { text: ['string'], start: 18, end: 24 }
          ])
        })

        it('should handle paragraph strategy with char splitter', () => {
          const input: string = 'hello\n\nworld'
          const result: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'paragraph',
            splitter: charSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hel', start: 0, end: 3 },
            { text: 'lo', start: 3, end: 5 },
            { text: 'wor', start: 7, end: 10 },
            { text: 'ld', start: 10, end: 12 }
          ])
        })

        it('should handle paragraph strategy with token splitter', () => {
          const input: string = 'hello\n\nworld'
          const result: Chunk[] = split(input, {
            chunkSize: 2,
            chunkStrategy: 'paragraph',
            splitter: tokenSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello\n\nworld', start: 0, end: 12 }
          ])
        })

        it('should handle paragraph strategy with chunkOverlap', () => {
          const input: string = 'hello\n\nworld\n\ntest'
          const result: Chunk[] = split(input, {
            chunkSize: 2,
            chunkOverlap: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello\n\nworld', start: 0, end: 12 },
            { text: 'world\n\ntest', start: 7, end: 18 }
          ])
        })

        it('should handle paragraph strategy with mixed content in array', () => {
          const input: string[] = ['hello\n\nworld', 'test', 'string\n\nend']
          const result: Chunk[] = split(input, {
            chunkSize: 2,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: ['hello\n\nworld'], start: 0, end: 12 },
            { text: ['test', 'string'], start: 12, end: 22 },
            { text: ['end'], start: 24, end: 27 }
          ])
        })

        it('should compare character vs paragraph strategies', () => {
          const input: string = 'hello\n\nworld test'
          const charResult: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: ChunkStrategy.character,
            splitter: whitespaceSplitter
          })
          const paragraphResult: Chunk[] = split(input, {
            chunkSize: 3,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          // Character strategy should split more aggressively
          assert(charResult.length >= paragraphResult.length)
          // Paragraph strategy should respect paragraph boundaries
          assert.deepStrictEqual(paragraphResult, [
            { text: 'hello\n\nworld test', start: 0, end: 17 }
          ])
        })

        it('should handle paragraph strategy with chunkSize larger than any paragraph', () => {
          const input: string = 'hello\n\nworld\n\ntest'
          const result: Chunk[] = split(input, {
            chunkSize: 100,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(result, [
            { text: 'hello\n\nworld\n\ntest', start: 0, end: 18 }
          ])
        })

        it('handles paragraphs within array items', () => {
          const input: string[] = [
            ' hello\nbig world! ',
            'This is the split test string in a very long long string.\n\nOf words. \n\nHi there',
            'Another.',
            ' '
          ]

          const result: Chunk[] = split(input, {
            chunkSize: 10,
            chunkOverlap: 2,
            splitter: whitespaceSplitter,
            chunkStrategy: 'paragraph'
          })
          assert.deepStrictEqual(result, [
            { text: ['hello\nbig world!'], start: 1, end: 17 },
            {
              text: ['big world! ', 'This is the split test string in a'],
              start: 7,
              end: 52
            },
            {
              text: ['in a very long long string.\n\nOf words. \n\nHi there'],
              start: 48,
              end: 97
            },
            { text: ['Hi there', 'Another.'], start: 89, end: 105 }
          ])
        })
      })

      // Edge cases and error conditions
      describe('edge cases', () => {
        it('should handle empty input with both strategies', () => {
          const emptyInput: string = ''
          const charResult: Chunk[] = split(emptyInput, {
            chunkStrategy: ChunkStrategy.character
          })
          const paragraphResult: Chunk[] = split(emptyInput, {
            chunkStrategy: 'paragraph'
          })
          assert.deepStrictEqual(charResult, [])
          assert.deepStrictEqual(paragraphResult, [])
        })

        it('should handle array with empty strings with both strategies', () => {
          const emptyArray: string[] = ['', '', '']
          const charResult: Chunk[] = split(emptyArray, {
            chunkStrategy: ChunkStrategy.character
          })
          const paragraphResult: Chunk[] = split(emptyArray, {
            chunkStrategy: 'paragraph'
          })
          assert.deepStrictEqual(charResult, [])
          assert.deepStrictEqual(paragraphResult, [])
        })

        it('should handle single character with both strategies', () => {
          const input: string = 'a'
          const charResult: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: ChunkStrategy.character
          })
          const paragraphResult: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph'
          })
          assert.deepStrictEqual(charResult, paragraphResult)
          assert.deepStrictEqual(charResult, [{ text: 'a', start: 0, end: 1 }])
        })

        it('should handle whitespace-only input with both strategies', () => {
          const input: string = '   '
          const charResult: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: ChunkStrategy.character,
            splitter: whitespaceSplitter
          })
          const paragraphResult: Chunk[] = split(input, {
            chunkSize: 1,
            chunkStrategy: 'paragraph',
            splitter: whitespaceSplitter
          })
          assert.deepStrictEqual(charResult, [])
          assert.deepStrictEqual(paragraphResult, [])
        })
      })
    })
  })
})
