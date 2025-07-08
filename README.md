# @nearform/llm-chunk

Efficient, configurable text chunking utility for LLM vectorization pipelines. Designed for high performance and flexibility, this library provides sophisticated chunking strategies with rich metadata for downstream vectorization and retrieval tasks.

## Features

- **Multiple Chunking Strategies**: Character-based and paragraph-based chunking
- **Token-Aware Chunking**: Configurable token splitting with custom splitter functions
- **Sub-Paragraph Chunking**: Automatically breaks long paragraphs at token boundaries
- **Configurable Overlap**: Maintains context between chunks with token-based overlap
- **Rich Metadata**: Returns detailed start/end positions for each chunk
- **Memory Efficient**: Generator-based iteration for large datasets
- **TypeScript Support**: Full type definitions and exported interfaces
- **High Performance**: Optimized algorithms for fast processing
- **Flexible Input**: Supports both single strings and arrays of strings

## Installation

```bash
npm install @nearform/llm-chunk
```

## Quick Start

```typescript
import { split } from '@nearform/llm-chunk'

const text = `This is the first paragraph with some content.

This is the second paragraph that contains more information.

And this is the third paragraph with additional details.`

// Basic paragraph chunking
const chunks = split(text, {
  chunkSize: 10, // Maximum 10 tokens per chunk
  chunkOverlap: 2, // 2 tokens overlap between chunks
  chunkStrategy: 'paragraph'
})

console.log(chunks)
// [
//   { text: 'This is the first paragraph with some content.', start: 0, end: 46 },
//   { text: 'This is the second paragraph that contains more information.', start: 48, end: 108 },
//   // ... more chunks
// ]
```

## API Reference

### Core Functions

#### `split(text, options?): ChunkResult[]`

Splits input text into an array of chunks with metadata.

**Parameters:**

- `text`: `string | string[]` - Text to chunk (single string or array)
- `options`: `SplitOptions` - Chunking configuration (optional)

**Returns:** `ChunkResult[]` - Array of chunk objects with text and position metadata

#### `iterateChunks(text, options?): Generator<ChunkResult>`

Memory-efficient generator that yields chunks one at a time.

**Parameters:**

- `text`: `string | string[]` - Text to chunk
- `options`: `SplitOptions` - Chunking configuration (optional)

**Returns:** `Generator<ChunkResult>` - Generator yielding chunk objects

#### `getChunk(text, start?, end?): string | string[]`

Extracts a substring or segments from the input text by character positions.

**Parameters:**

- `text`: `string | string[]` - Source text
- `start`: `number` - Start position (inclusive, default: 0)
- `end`: `number` - End position (exclusive, default: text length)

**Returns:** Substring for string input, array of segments for array input

### Configuration Options

#### `SplitOptions`

```typescript
interface SplitOptions {
  /** Maximum size of each chunk in tokens (default: 512) */
  chunkSize?: number

  /** Number of tokens to overlap between chunks (default: 0) */
  chunkOverlap?: number

  /** Custom function to split text into tokens (default: character-based) */
  splitter?: (text: string) => string[]

  /** Chunking strategy (default: 'paragraph') */
  chunkStrategy?: 'paragraph'
}
```

#### `ChunkResult`

```typescript
interface ChunkResult {
  /** The chunked text content */
  text: string | string[]

  /** Start character position in original text */
  start: number

  /** End character position in original text */
  end: number
}
```

## Usage Examples

### Basic Paragraph Chunking

```typescript
import { split } from '@nearform/llm-chunk'

const document = `Introduction paragraph.

Main content paragraph with lots of details.

Conclusion paragraph.`

const chunks = split(document, {
  chunkSize: 20,
  chunkStrategy: 'paragraph'
})
```

### Word-Based Tokenization

```typescript
import { split } from '@nearform/llm-chunk'

const text = 'The quick brown fox jumps over the lazy dog.'

// Custom word-based splitter
const wordSplitter = (text: string) =>
  text.split(/\s+/).filter(word => word.length > 0)

const chunks = split(text, {
  chunkSize: 5, // 5 words per chunk
  chunkOverlap: 1, // 1 word overlap
  splitter: wordSplitter,
  chunkStrategy: 'paragraph'
})
```

### Token-Based Chunking with Tiktoken

```typescript
import { split } from '@nearform/llm-chunk'
import { get_encoding } from 'tiktoken'

const encoding = get_encoding('gpt2')

// Token-based splitter for accurate LLM token counting
const tokenSplitter = (text: string) => {
  const tokens = encoding.encode(text)
  return tokens.map(token => encoding.decode([token]))
}

const chunks = split(longDocument, {
  chunkSize: 100, // 100 tokens per chunk
  chunkOverlap: 10, // 10 tokens overlap
  splitter: tokenSplitter,
  chunkStrategy: 'paragraph'
})

encoding.free() // Clean up
```

### Processing Large Documents with Generator

```typescript
import { iterateChunks } from '@nearform/llm-chunk'

// Memory-efficient processing of large documents
for (const chunk of iterateChunks(largeDocument, { chunkSize: 200 })) {
  // Process each chunk individually
  await processChunk(chunk)
}
```

### Array of Texts

```typescript
import { split } from '@nearform/llm-chunk'

const documents = [
  'First document content.',
  'Second document content.',
  'Third document content.'
]

const chunks = split(documents, {
  chunkSize: 50,
  chunkOverlap: 5
})
```

## Advanced Features

### Sub-Paragraph Chunking

When a single paragraph exceeds the chunk size limit, the library automatically breaks it into smaller chunks at token boundaries while maintaining overlap:

```typescript
const longParagraph =
  'This is a very long paragraph that exceeds the chunk size limit and needs to be broken down into smaller pieces while maintaining context between chunks.'

const chunks = split(longParagraph, {
  chunkSize: 10, // Small chunk size to force sub-paragraph chunking
  chunkOverlap: 2, // Maintain context with overlap
  splitter: text => text.split(' ') // Word-based tokenization
})

// Results in multiple chunks with overlap between them
```

### Custom Token Splitting

The `splitter` function allows you to define how text is tokenized:

```typescript
// Character-based (default)
const charSplitter = (text: string) => text.split('')

// Word-based
const wordSplitter = (text: string) => text.split(/\s+/)

// Sentence-based
const sentenceSplitter = (text: string) => text.split(/[.!?]+/)

// Custom tokenizer integration
const customSplitter = (text: string) => yourTokenizer.encode(text)
```

## Key Behaviors

- **Token-Based Sizing**: Chunk sizes are measured in tokens (as defined by your splitter), not characters
- **Joiner Exclusion**: Paragraph joiners (`\n\n`) don't count toward chunk size limits
- **Automatic Sub-chunking**: Long paragraphs are automatically broken down while preserving overlap
- **Position Tracking**: Accurate character positions maintained for all chunks
- **Memory Efficiency**: Generator-based iteration for large datasets

## Performance

The library is optimized for performance with:

- Binary search algorithms for efficient chunk boundary detection
- Memory-efficient generator-based processing
- Minimal string copying and manipulation
- Optimized overlap calculations

## Testing

```bash
npm test
```

The library includes comprehensive test coverage for all chunking strategies, edge cases, and tokenization scenarios.

## Contributing

Contributions, issues, and feature requests are welcome! Please feel free to:

- Open an issue for bug reports or feature requests
- Submit a pull request with improvements
- Suggest new chunking strategies or tokenization methods

## License

MIT

---

**Need Help?** Open an issue on GitHub or contact the maintainers for support with integration or advanced use cases.
