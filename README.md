# llm-chunk

Efficient, configurable text chunking utility for LLM vectorization. Returns rich chunk metadata.

## Features

- Fast, memory-efficient chunking for large texts or arrays of texts
- Supports character, sentence, and paragraph chunking strategies
- Configurable chunk size and overlap
- Returns detailed metadata for each chunk (start/end indices and positions)
- TypeScript support
- Robust, tested API

## Installation

```bash
npm install llm-chunk
```

## Usage

```typescript
import { split, iterateChunks, getChunk, SplitOptions, Chunk } from 'llm-chunk'

const text =
  'This is a long document. It has multiple sentences.\n\nAnd paragraphs.'
const options: SplitOptions = {
  chunkSize: 50,
  chunkOverlap: 10,
  chunkStrategy: 'sentence' // or 'paragraph'
}

// Get all chunks as an array
const chunks: Chunk[] = split(text, options)

// Or use the generator for streaming/large data
for (const chunk of iterateChunks(text, options)) {
  console.log(chunk)
}

// Get a substring from the original text(s)
const sub = getChunk(text, 0, 20)
```

## API

### `split(text, options?): Chunk[]`

Splits the input text(s) into an array of chunk objects.

### `iterateChunks(text, options?): Generator<Chunk>`

Yields chunk objects one at a time (memory efficient for large inputs).

### `getChunk(text, start?, end?): string`

Returns the substring from the input text(s) between start and end character positions.

### `SplitOptions`

- `chunkSize` (number): Maximum size of each chunk (default: 512)
- `chunkOverlap` (number): Number of characters to overlap between chunks (default: 0)
- `lengthFunction` (function): Optional function to calculate the length of the text (default: `text.length`)
- `chunkStrategy` ('sentence' | 'paragraph'): Optional chunking strategy. If set, overrides character-based chunking.

### `Chunk`

- `chunk` (string): The chunked text
- `startIndex` (number): Index in the input array or unit array
- `startPosition` (number): Character offset in the original string
- `endIndex` (number): Index in the input array or unit array
- `endPosition` (number): Character offset in the original string

## Testing

```bash
npm test
```

## License

ISC
