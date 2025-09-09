# `llm-splitter`

[![npm version](https://badgen.net/npm/v/llm-splitter?icon=npm)](https://www.npmjs.com/package/llm-splitter)
[![GitHub release](https://badgen.net/github/release/nearform/llm-splitter?icon=github)](https://github.com/nearform/llm-splitter)
[![GitHub CI](https://badgen.net/github/checks/nearform/llm-splitter?icon=github)](https://github.com/nearform/llm-splitter)

A JavaScript library for splitting text into configurable chunks with overlap support.

## Features

- 📖 **Paragraph-Aware Chunking**: Respects document structure while maintaining token limits
- 🧠 **LLM Optimized**: Designed for vectorization with tiktoken and other tokenizers
- 📊 **Rich Metadata**: Complete character position tracking for all chunks
- ⚡ **High Performance**: Single pass greedy algorithms for optimized processing
- 🎨 **Flexible Input**: Supports strings, arrays, and custom tokenization
- 📝 **TypeScript**: Full type safety with comprehensive interfaces

## Installation

```sh
$ npm install llm-splitter
```

## Usage

```js
import { split, getChunk } from 'llm-splitter'
```

## API

### `split(input, options)`

Splits text into chunks based on a custom splitter function.

Each chunk contains positional data (`start` and `end`) that may be used to separately retrieve the chunk string (or array of strings) from those arguments alone via `getChunk()`. The purpose of this pairing is for the common scenario of wanting to store embeddings for a chunk in a data (e.g. `pgvector`) but not wanting to also directly store the chunk -- yet being able to get the full text of the chunk later if you have the original string input.

#### Parameters

- `input` (string|string[]) - The text or array of texts to split
- `options` (Object) - Configuration options
  - `chunkSize` (number) - Maximum number of tokens per chunk (default: 512)
  - `chunkOverlap` (number) - Number of overlapping tokens between chunks (default: 0)
  - `splitter` (Function) - Function to split text into tokens (default: character-by-character)

Notes:

- `chunkSize` must be a positive integer ≥ 1
- `chunkOverlap` must be a non-negative integer ≥ 0
- `chunkOverlap` must be less than `chunkSize`
- `splitter` functions can omit text when splitting, but should not mutate the emitted tokens. This means that splitting by spaces is fine (e.g. `(t) => t.split(" ")`) but splitting and changing text is **not allowed** (e.g. `(t) => t.split(" ").map((x) => x.toUpperCase())`).

#### Returns

Returns an array of chunk objects with the following structure:

```js
{
  text: string | string[], // The chunk text
  start: number,           // Start position in the original text
  end: number              // End position in the original text
}
```

#### Examples

**Basic usage with default options:**

```js
const text = 'Hello world! This is a test.'
const chunks = split(text)

// =>
// Splits into character-level chunks of 512 characters, which is just the original string here ;)
;[{ text: 'Hello world! This is a test.', start: 0, end: 28 }]
```

**Custom chunk size and overlap:**

```js
const text = 'Hello world! This is a test.'
const chunks = split(text, {
  chunkSize: 10,
  chunkOverlap: 2
})

// =>
;[
  { text: 'Hello worl', start: 0, end: 10 },
  { text: 'rld! This ', start: 8, end: 18 },
  { text: 's is a tes', start: 16, end: 26 },
  { text: 'est.', start: 24, end: 28 }
]
```

**Word-based splitting:**

```js
const text = 'Hello world! This is a test.'
const chunks = split(text, {
  chunkSize: 3,
  chunkOverlap: 1,
  splitter: text => text.split(/\s+/)
})

// =>
;[
  { text: 'Hello world! This', start: 0, end: 17 },
  { text: 'This is a', start: 13, end: 22 },
  { text: 'a test.', start: 21, end: 28 }
]
```

**Array of strings:**

```js
const texts = ['Hello world!', 'This is a test.']
const chunks = split(texts, {
  chunkSize: 5,
  splitter: text => text.split(' ')
})

// =>
;[
  { text: ['Hello world!', 'This is a'], start: 0, end: 21 },
  { text: ['test.'], start: 22, end: 27 }
]
```

**Paragraph chunking**

By default, we assemble chunks with as many tokens fit in. This default is considered the `chunkStrategy = "character"`. Another options is to fit as many whole _paragraphs_ (denoted by string array end or `\n\n` characters) as we can into a chunk, but not splitting up paragraphs unless the paragraph of tokens is at the start of the chunk, in which case we then split across as many subsequent chunks as we need to. This approach allows you to keep paragraph structures more contained within chunks which may yield advantageous context outcomes for your upstream usage (in a RAG app, etc).

<details>
  <summary>See example...</summary>

```js
// Mix of paragraphs across array items and within items with `\n\n` marker.
const texts = [
  'Who has seen the wind?\n\nNeither I nor you.',
  'But when the leaves hang trembling,',
  'The wind is passing through.',
  'Who has seen the wind?\n\nNeither you nor I.',
  'But when the trees bow down their heads,',
  'The wind is passing by.'
]
const chunks = split(text10, {
  chunkSize: 20,
  chunkOverlap: 2,
  chunkStrategy: 'paragraph',
  splitter: text => text.split(/\s+/)
})

// =>
;[
  {
    text: [
      'Who has seen the wind?\n\nNeither I nor you.',
      'But when the leaves hang trembling,',
      'The wind is passing through.'
    ],
    start: 0,
    end: 105
  },
  {
    text: [
      'passing through.',
      'Who has seen the wind?\n\nNeither you nor I.',
      'But when the trees bow down their heads,'
    ],
    start: 89,
    end: 187
  },
  {
    text: ['their heads,', 'The wind is passing by.'],
    start: 175,
    end: 210
  }
]
```

</details>

### `getChunk(input, start, end)`

Extracts a specific chunk of text from the original input based on start and end positions. For array `input` the positions are treated as if all elements in the array were concatenated into a single long string.

Note that for arrays, the returned result will be an array and that the first and/or last element of the array may be a substring of that array item's text.

#### Parameters

- `input` (string|string[]) - The original input text or array of texts
- `start` (number) - Start position in the original text
- `end` (number) - End position in the original text

#### Returns

- `string` - For single string input
- `string[]` - For array of strings input

#### Examples

```js
const text = 'Hello world! This is a test.'
const chunk = getChunk(text, 0, 12)
// =>
;('Hello world!')

const texts = ['Hello world!', 'This is a test.']
const chunk = getChunk(texts, 0, 16)
// =>
;['Hello world!', 'This']
```

## Advanced Usage

### Custom Splitter Functions

You can create custom splitter functions for different tokenization strategies:

#### Sentences

Split by sentences using a regular expression.

```js
// Sentence-based splitting
const sentenceSplitter = text => text.split(/[.!?]+/)
const chunks = split(text, {
  chunkSize: 5,
  splitter: sentenceSplitter
})

// =>
;[{ text: 'Hello world! This is a test', start: 0, end: 27 }]
```

#### TikToken

Split using the TikToken tokenizer with the commonly used `text-embedding-ada-002` model.

<details>
  <summary>See example...</summary>

```js
import tiktoken from 'tiktoken'

// Create a tokenizer for a specific model
const tokenizer = tiktoken.encoding_for_model('text-embedding-ada-002')
const td = new TextDecoder()

// Create a token splitter function
const tokenSplitter = text =>
  Array.from(tokenizer.encode(text)).map(token =>
    td.decode(tokenizer.decode([token]))
  )

const text = 'Hello world! This is a test.'
const chunks = split(text, {
  chunkSize: 3,
  chunkOverlap: 1,
  splitter: tokenSplitter
})

// Don't forget to free the tokenizer when done
tokenizer.free()

// =>
;[
  { text: 'Hello world!', start: 0, end: 12 },
  { text: '! This is', start: 11, end: 20 },
  { text: ' is a test', start: 17, end: 27 },
  { text: ' test.', start: 22, end: 28 }
]
```

</details>

### Working with Overlaps

Chunk overlap is useful for maintaining context between chunks:

<details>
  <summary>See example...</summary>

```js
const text = 'This is a very long document that needs to be split into chunks.'
const chunks = split(text, {
  chunkSize: 10,
  chunkOverlap: 3,
  splitter: text => text.split(' ')
})
// Each chunk will share 3 words with the previous chunk
// =>
;[
  {
    text: 'This is a very long document that needs to be',
    start: 0,
    end: 45
  },
  { text: 'needs to be split into chunks.', start: 34, end: 64 }
]
```

</details>

### Multibyte / Unicode Strings

Splitting on multibyte / unicode strings can cause malformed chunks and internal errors to be thrown if `start`/`end` token or chunk positions can't be determined. We are presently tracking this in [an issue](https://github.com/nearform/llm-splitter/issues/36).

If your input has these characters, at present we recommend pre-processing and stripping them out before calling `split` like:

```js
const input = 'Hello there! 👋🏻'
const removeNonAscii = str => str.replace(/[^\x00-\x7F]/g, '')
const strippedInput = removeNonAscii(input) // => "Hello there! "

const chunks = split(strippedInput)
for (const { start, end } of chunks) {
  // Use `strippedInput`, not `input` for the correct string retrieval!
  const retrieved = getChunk(strippedInput, start, end)
  console.log('Retrieved chunk:', { retrieved, start, end })
}
```

Note then that calls with `start` and `end` to `getChunk` must use your processed/stripped input and not the original input!

## License

MIT
