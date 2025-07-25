import { describe, it } from 'node:test'
import assert from 'node:assert'
import { type Chunk, split, getChunk } from '../src/index.js'

// Helper splitters
const charSplitter = (text: string): string[] => [...text]
const whitespaceSplitter = (text: string): string[] => text.split(/\s+/)
const sentenceSplitter = (text: string): string[] =>
  text.split(/[.!?]+/).filter(s => s.trim().length > 0)

describe('index (integration)', () => {
  describe('short strings', () => {
    it('should handle single character with char splitter', () => {
      const input: string = 'a'
      const chunks: Chunk[] = split(input, {
        chunkSize: 1,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle short word with whitespace splitter', () => {
      const input: string = 'hello'
      const chunks: Chunk[] = split(input, {
        chunkSize: 2,
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle short sentence with sentence splitter', () => {
      const input: string = 'Hello world.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 1,
        splitter: sentenceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('long strings', () => {
    it('should handle long text with char splitter and overlap', () => {
      const input: string =
        'This is a very long text that contains many characters and should be split into multiple chunks with overlap between them.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 20,
        chunkOverlap: 5,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle long text with whitespace splitter and paragraph strategy', () => {
      const input: string =
        'This is the first paragraph with many words that should be grouped together.\n\nThis is the second paragraph that should also be kept together as much as possible.\n\nAnd here is a third paragraph to test the paragraph chunking strategy.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 10,
        chunkOverlap: 2,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle long text with sentence splitter and character strategy', () => {
      const input: string =
        'This is the first sentence. This is the second sentence with more words. Here comes the third sentence. And finally, the fourth sentence to complete our test.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 3,
        chunkOverlap: 1,
        chunkStrategy: 'character',
        splitter: sentenceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('arrays of short strings', () => {
    it('should handle array of short strings with char splitter', () => {
      const input: string[] = ['a', 'b', 'c']
      const chunks: Chunk[] = split(input, {
        chunkSize: 2,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle array of short strings with whitespace splitter and overlap', () => {
      const input: string[] = ['hello', 'world', 'test']
      const chunks: Chunk[] = split(input, {
        chunkSize: 3,
        chunkOverlap: 1,
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('arrays of medium strings', () => {
    it('should handle array of medium strings with sentence splitter', () => {
      const input: string[] = [
        'Hello world.',
        'This is a test.',
        'Another sentence here.'
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 2,
        splitter: sentenceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle array of medium strings with paragraph strategy', () => {
      const input: string[] = [
        'First paragraph.\n\nSecond part.',
        'Third paragraph here.',
        'Fourth and final paragraph.'
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 5,
        chunkOverlap: 1,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('arrays of long strings', () => {
    it('should handle array of long strings with char splitter and overlap', () => {
      const input: string[] = [
        'This is a very long first string that contains many characters and should be split appropriately.',
        'This is the second long string with different content but similar length for testing purposes.',
        'And here is the third long string to complete our array of long strings for comprehensive testing.'
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 30,
        chunkOverlap: 8,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle array of long strings with whitespace splitter and character strategy', () => {
      const input: string[] = [
        'This is the first long paragraph with many words that should be processed correctly by the splitter function.',
        'Here is the second paragraph with different content but similar structure for testing the whitespace splitter.',
        'Finally, this is the third paragraph to ensure our array of long strings works properly with the character strategy.'
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 15,
        chunkOverlap: 3,
        chunkStrategy: 'character',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('strings with \\n\\n inside them', () => {
    it('should handle single string with \\n\\n and paragraph strategy', () => {
      const input: string =
        'First paragraph.\n\nSecond paragraph here.\n\nThird and final paragraph.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 5,
        chunkOverlap: 1,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle single string with \\n\\n and character strategy', () => {
      const input: string = 'Hello\n\nworld\n\ntest'
      const chunks: Chunk[] = split(input, {
        chunkSize: 8,
        chunkOverlap: 2,
        chunkStrategy: 'character',
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle array with \\n\\n in strings and paragraph strategy', () => {
      const input: string[] = [
        'First item.\n\nSecond part.',
        'Third item here.',
        'Fourth item.\n\nFifth part.'
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 4,
        chunkOverlap: 1,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle complex array with \\n\\n and mixed strategies', () => {
      const input: string[] = [
        ' hello\nbig world! ',
        'This is the split test string in a very long long string.\n\nOf words. \n\nHi there',
        'Another.',
        ' '
      ]
      const chunks: Chunk[] = split(input, {
        chunkSize: 10,
        chunkOverlap: 2,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('mixed parameter combinations', () => {
    it('should handle small chunkSize with large overlap', () => {
      const input: string =
        'This is a test string for small chunks with large overlap.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 3,
        chunkOverlap: 2,
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle large chunkSize with no overlap', () => {
      const input: string = 'Short text for large chunks.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 100,
        chunkOverlap: 0,
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle paragraph strategy with sentence splitter', () => {
      const input: string =
        'First sentence.\n\nSecond sentence here. Third sentence.\n\nFourth sentence.'
      const chunks: Chunk[] = split(input, {
        chunkSize: 2,
        chunkOverlap: 1,
        chunkStrategy: 'paragraph',
        splitter: sentenceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle character strategy with custom splitter', () => {
      const input: string = 'Hello,world;test:split'
      const customSplitter = (text: string): string[] => text.split(/[,;:]/)
      const chunks: Chunk[] = split(input, {
        chunkSize: 3,
        chunkOverlap: 1,
        chunkStrategy: 'character',
        splitter: customSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const input: string = ''
      const chunks: Chunk[] = split(input, {
        chunkSize: 5,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle array with empty strings', () => {
      const input: string[] = ['', 'hello', '', 'world', '']
      const chunks: Chunk[] = split(input, {
        chunkSize: 3,
        splitter: charSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })

    it('should handle whitespace-only string', () => {
      const input: string = '   \n\n  \t  '
      const chunks: Chunk[] = split(input, {
        chunkSize: 2,
        chunkStrategy: 'paragraph',
        splitter: whitespaceSplitter
      })

      for (const chunk of chunks) {
        const retrievedText = getChunk(input, chunk.start, chunk.end)
        assert.deepStrictEqual(chunk.text, retrievedText)
      }
    })
  })
})
