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
- `options` (object) - Configuration options
  - `chunkSize` (number) - Maximum number of tokens per chunk (default: `512`)
  - `chunkOverlap` (number) - Number of overlapping tokens between chunks (default: `0`)
  - `chunkStrategy` (string) - Grouping preference for chunks (default: `"character"`)
  - `splitter` (function) - Function to split text into tokens (default: character-by-character)

Notes:

- `chunkSize` must be a positive integer ≥ 1
- `chunkOverlap` must be a non-negative integer ≥ 0
- `chunkOverlap` must be less than `chunkSize`
- `splitter` functions can omit text when splitting, but should not mutate the emitted tokens. This means that splitting by spaces is fine (e.g. `(t) => t.split(" ")`) but splitting and changing text is **not allowed** (e.g. `(t) => t.split(" ").map((x) => x.toUpperCase())`).
- Here are some sample `splitter` functions:
  - Character: `text => text.split('')` (default)
  - Word: `text => text.split(/\s+/)`
  - Sentence: `text => text.split(/[.!?]+/)`
  - Line: `text => text.split(/\n/)`

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

Processing text with multibyte characters (Unicode characters with char codes greater than 255 -- e.g. emojis) is problematic for tokenizers that can split strings across byte boundaries (as noted by [other text splitting libraries](https://js.langchain.com/docs/how_to/split_by_token/)). `llm-splitter` needs to determine the `start`/`end` locations of each chunk and thus have to find locations for the split parts in the original input(s).

How `llm-splitter` approaches the multibyte characters problem as follows -- for each part produced by `splitter()`:

- If part doesn't have multibyte characters, then should be completely matched.
- Try to do a simple string `startsWith(part)` match. This will correctly match on many strings with multibyte characters in them.
- If that fails, then ignore the multibyte characters, and iterate through the part until we find a match on the single-byte parts. At this point we will potentially multibyte characters to just match on strings starting with single-byte characters.

When the parts are then gathered into chunks and aggregated into `{ text, start, end }` array items, this means that some of the chunks will _undercount_ the number of parts produced by the `splitter()` function. In a simple test we conducted on 10MB of blog post content using the `tiktoken` tokenizer in our `splitter()` function, our results were that for the 3 million parts produced 99.6% of them matched without needing to ignore multibyte characters. So, if your chunking implementation is need hard constraints (like embedding API max tokens) on how large the chunks can be, we would advise to add a padding amount in your `chunkSize` to accomodate this if your text processing corpus contains multibyte strings. Additionally, if a large number of multibyte strings are prevalent, it would likely make sense to do some upfront analysis to determine a proper padding for `chunkSize`.

Let's take a quick look at this in action working with multibyte emojis and a `tiktoken`-based splitter:

```js
const text = `
A noiseless 🤫 patient spider, 🕷️
I mark'd where on a little 🏔️ promontory it stood isolated,
Mark'd how to explore 🔍 the vacant vast 🌌 surrounding,
`

const chunks = split(text, {
  chunkSize: 15,
  chunkOverlap: 2,
  chunkStrategy: 'paragraph',
  splitter: tokenSplitter // from previous example
})

console.log(JSON.stringify(chunks, null, 2))
// =>
;[
  {
    text: "\nA noiseless 🤫 patient spider, 🕷️\nI mark'd where on",
    start: 0,
    end: 53
  },
  {
    text: " where on a little 🏔️ promontory it stood isolated,\nMark'd how",
    start: 44,
    end: 107
  },
  {
    text: "'d how to explore 🔍 the vacant vast 🌌 surrounding,\n",
    start: 101,
    end: 154
  }
]
```

Ultimately, this approach represents a tradeoff: while some higher-level Unicode data may be lost during the splitting process, it ensures that chunk start/end positions can be reliably determined with any user-supplied splitter function, preventing malformed chunks and internal errors.

## License

MIT
