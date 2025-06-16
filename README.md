# llm-chunk

Efficient, configurable text chunking utility for LLM vectorization pipelines. Designed for high performance and flexibility, it returns rich chunk metadata for downstream vectorization or retrieval tasks.

## Features

- Fast, memory-efficient chunking for large texts or arrays of texts
- Supports character and paragraph chunking strategies
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
  chunkStrategy: 'paragraph' // only 'paragraph' is supported as a strategy override
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

- Returns: `Chunk[]` – An array of chunk metadata objects. Each object contains the chunked text and its metadata.

### `iterateChunks(text, options?): Generator<Chunk>`

Yields chunk objects one at a time (memory efficient for large inputs).

### `getChunk(text, start?, end?)`

Returns a substring or array of string segments from the input text(s) between start and end character positions.

- If `text` is a string: returns a substring from `start` to `end`.
- If `text` is a string array: returns an array of string segments covering the range from `start` to `end` (may span multiple array elements).

#### Examples

```typescript
getChunk('abcdef', 1, 4) // 'bcd'
getChunk(['abc', 'def', 'ghi'], 2, 7) // ['c', 'def', 'g']
```

### `SplitOptions`

- `chunkSize` (number): Maximum size of each chunk (default: 512)
- `chunkOverlap` (number): Number of characters to overlap between chunks (default: 0)
- `lengthFunction` (function): Optional function to calculate the length of the text (default: `text.length`)
- `chunkStrategy` ('paragraph'): Optional chunking strategy. If set, overrides character-based chunking.

### `ChunkResult`

- `text` (`string | string[]`): The chunked text. May be a string or an array of strings, depending on input and chunking strategy.
- `start` (`number`): Start character offset in the original input.
- `end` (`number`): End character offset in the original input.

> Note: Some older documentation or code comments may refer to this as `Chunk`. The correct exported type is `ChunkResult`.

## Configuration & Extensibility

You can extend chunking strategies by providing custom logic or by contributing to the project. The API is designed for easy integration into LLM pipelines and vector stores.

## Testing

```bash
npm test
```

## Contributing

Contributions, issues, and feature requests are welcome! Please open an issue or submit a pull request.

## License

ISC

---

For questions or support, contact the maintainer or open an issue on GitHub.
