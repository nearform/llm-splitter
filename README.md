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
- 📝 **Typed**: Authored in JS with JSDoc annotations; ships `.d.ts` type definitions for full editor and TypeScript consumer support

## Installation

```sh
$ npm install llm-splitter
```

## Usage

```js
import { split, getChunk } from "llm-splitter";
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

- `input` must be a `string` or an array whose elements are all strings; anything else throws `TypeError`.
- `chunkSize` must be a positive integer ≥ 1
- `chunkOverlap` must be a non-negative integer ≥ 0
- `chunkOverlap` must be less than `chunkSize`
- `splitter` must return an array of strings; returning a non-array throws `TypeError`.
- `splitter` functions can omit text when splitting, but should not mutate the emitted tokens. This means that splitting by spaces is fine (e.g. `(t) => t.split(" ")`) but splitting and changing text is **not allowed** (e.g. `(t) => t.split(" ").map((x) => x.toUpperCase())`). A mutating splitter will throw at runtime when a token can't be located in the source.
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
const text = "Hello world! This is a test.";
const chunks = split(text);

// =>
// Splits into character-level chunks of 512 characters, which is just the original string here ;)
[{ text: "Hello world! This is a test.", start: 0, end: 28 }];
```

**Custom chunk size and overlap:**

```js
const text = "Hello world! This is a test.";
const chunks = split(text, {
  chunkSize: 10,
  chunkOverlap: 2,
});

// =>
[
  { text: "Hello worl", start: 0, end: 10 },
  { text: "rld! This ", start: 8, end: 18 },
  { text: "s is a tes", start: 16, end: 26 },
  { text: "est.", start: 24, end: 28 },
];
```

**Word-based splitting:**

```js
const text = "Hello world! This is a test.";
const chunks = split(text, {
  chunkSize: 3,
  chunkOverlap: 1,
  splitter: (text) => text.split(/\s+/),
});

// =>
[
  { text: "Hello world! This", start: 0, end: 17 },
  { text: "This is a", start: 13, end: 22 },
  { text: "a test.", start: 21, end: 28 },
];
```

**Array of strings:**

```js
const texts = ["Hello world!", "This is a test."];
const chunks = split(texts, {
  chunkSize: 5,
  splitter: (text) => text.split(" "),
});

// =>
[
  { text: ["Hello world!", "This is a "], start: 0, end: 22 },
  { text: ["test."], start: 22, end: 27 },
];
```

**Paragraph chunking**

By default, we assemble chunks with as many tokens fit in. This default is considered the `chunkStrategy = "character"`. Another options is to fit as many whole _paragraphs_ (denoted by string array end or `\n\n` characters) as we can into a chunk, but not splitting up paragraphs unless the paragraph of tokens is at the start of the chunk, in which case we then split across as many subsequent chunks as we need to. This approach allows you to keep paragraph structures more contained within chunks which may yield advantageous context outcomes for your upstream usage (in a RAG app, etc).

<details>
  <summary>See example...</summary>

```js
// Mix of paragraphs across array items and within items with `\n\n` marker.
const texts = [
  "Who has seen the wind?\n\nNeither I nor you.",
  "But when the leaves hang trembling,",
  "The wind is passing through.",
  "Who has seen the wind?\n\nNeither you nor I.",
  "But when the trees bow down their heads,",
  "The wind is passing by.",
];
const chunks = split(text10, {
  chunkSize: 20,
  chunkOverlap: 2,
  chunkStrategy: "paragraph",
  splitter: (text) => text.split(/\s+/),
});

// =>
[
  {
    text: [
      "Who has seen the wind?\n\nNeither I nor you.",
      "But when the leaves hang trembling,",
      "The wind is passing through.",
    ],
    start: 0,
    end: 105,
  },
  {
    text: [
      "passing through.",
      "Who has seen the wind?\n\nNeither you nor I.",
      "But when the trees bow down their heads,",
    ],
    start: 89,
    end: 187,
  },
  {
    text: ["their heads,", "The wind is passing by."],
    start: 175,
    end: 210,
  },
];
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
const text = "Hello world! This is a test.";
const chunk = getChunk(text, 0, 12);
// =>
("Hello world!");

const texts = ["Hello world!", "This is a test."];
const chunk = getChunk(texts, 0, 16);
// =>
["Hello world!", "This"];
```

## Advanced Usage

### Custom Splitter Functions

You can create custom splitter functions for different tokenization strategies:

#### Sentences

Split by sentences using a regular expression.

```js
// Sentence-based splitting
const sentenceSplitter = (text) => text.split(/[.!?]+/);
const chunks = split(text, {
  chunkSize: 5,
  splitter: sentenceSplitter,
});

// =>
[{ text: "Hello world! This is a test.", start: 0, end: 28 }];
```

#### TikToken

Split using the TikToken tokenizer with the commonly used `text-embedding-ada-002` model.

<details>
  <summary>See example...</summary>

```js
import tiktoken from "tiktoken";

// Create a tokenizer for a specific model
const tokenizer = tiktoken.encoding_for_model("text-embedding-ada-002");
const td = new TextDecoder();

// Create a token splitter function
const tokenSplitter = (text) =>
  Array.from(tokenizer.encode(text)).map((token) =>
    td.decode(tokenizer.decode([token])),
  );

const text = "Hello world! This is a test.";
const chunks = split(text, {
  chunkSize: 3,
  chunkOverlap: 1,
  splitter: tokenSplitter,
});

// Don't forget to free the tokenizer when done
tokenizer.free();

// =>
[
  { text: "Hello world!", start: 0, end: 12 },
  { text: "! This is", start: 11, end: 20 },
  { text: " is a test", start: 17, end: 27 },
  { text: " test.", start: 22, end: 28 },
];
```

</details>

### Working with Overlaps

Chunk overlap is useful for maintaining context between chunks:

<details>
  <summary>See example...</summary>

```js
const text = "This is a very long document that needs to be split into chunks.";
const chunks = split(text, {
  chunkSize: 10,
  chunkOverlap: 3,
  splitter: (text) => text.split(" "),
});
// Each chunk will share 3 words with the previous chunk
// =>
[
  {
    text: "This is a very long document that needs to be",
    start: 0,
    end: 45,
  },
  { text: "needs to be split into chunks.", start: 34, end: 64 },
];
```

</details>

### Chunk Coverage and Positions

`split()` is **lossless on positions** from `chunks[0].start` onward: every UTF-16 code unit of the source string at index `p` (where `chunks[0].start <= p < input.length`) appears in at least one chunk's `[start, end)` range. `start` and `end` are JavaScript string indices — i.e. UTF-16 code-unit offsets — so for non-ASCII text a single character may occupy one or two code units (a typical emoji is two; a CJK character is one). Concretely:

- `chunks[i].end >= chunks[i+1].start` for every adjacent pair (`>=` because `chunkOverlap` may make them overlap; without overlap they're equal).
- `chunks[chunks.length - 1].end === input.length`.

The reason: chunks return `{ start, end }` so downstream code can locate them in the source — for RAG citations, source highlighting, re-chunking, completeness checks, and so on. If `split()` dropped code units that the splitter happened to skip (whitespace, paragraph delimiters, tokens that couldn't be anchored), those positions would belong to no chunk and position-based queries would have gaps in their answers ("which chunk owns position 12?" → none). A consumer who wants trimmed chunk text can call `chunk.text.trim()` themselves; going the other way (we trim, they want the content back) is impossible without re-reading the source. So the library keeps everything.

Practical consequences:

- **Chunk starts are clean.** In `chunkStrategy: "paragraph"` mode, leading whitespace inside a paragraph is stripped before anchoring, so `chunks[i].start` (for `i > 0`) lands on real content.
- **Chunk ends may carry trailing whitespace.** When the splitter drops code units at a paragraph or token boundary, those positions get absorbed into the _previous_ chunk by extending its `end` forward to meet the next chunk's `start`. So a chunk's `text` may end with `"\n\n"` or trailing whitespace — those positions weren't "extra," they were the gap between the splitter's last token in this chunk and the first token in the next.
- **Leading code units before `chunks[0].start` are uncovered.** If the very first paragraph has leading whitespace, those positions appear in no chunk (no previous chunk to extend forward into them). This is the one place coverage is not full.

For LLM input this also tends to help, not hurt: a chunk ending with `"\n\n"` carries an explicit paragraph-boundary signal that the model can read.

### Multibyte / Unicode Strings

Processing text with multibyte Unicode characters (emoji, CJK, accented Latin, combining marks) is problematic for tokenizers that split byte streams without regard to character boundaries (as noted by [other text splitting libraries](https://js.langchain.com/docs/how_to/split_by_token/)). When a tokenizer like `tiktoken` decodes a token that straddles a multi-byte sequence, the result is a JavaScript string containing U+FFFD replacement characters (and sometimes isolated combining marks). `llm-splitter` needs to map each such part back to a `start`/`end` position in the original input.

`llm-splitter` anchors each part against the source string with a three-tier locate strategy (cheapest first):

1. **`startsWith` at cursor** — byte-preserving splitter with the cursor sitting exactly on the next part (the char and tiktoken happy paths).
2. **`indexOf(part)` forward from cursor** — byte-preserving splitter that drops bytes between parts (e.g. `text.split(/\s+/)` discards whitespace, so the cursor lands in the gap and tier 1 fails). The whole part still exists verbatim in source, so a native substring search finds it without allocating.
3. **`indexOf(firstAnchorGrapheme(part))` forward from cursor** — byte-mutating splitter (e.g. `tiktoken` emitting U+FFFD when a token straddles a multi-byte sequence). Walk the part's [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) graphemes to find the first one that is _anchorable_ (not U+FFFD, not a combining mark or variation selector); locate that grapheme in input and anchor there. `end` is `start + part.length` (clamped to input length). indexOf is safe here because anchor graphemes are full grapheme clusters that, by construction, never start with a low surrogate or combining mark — a code-unit match cannot land mid-surrogate.

Two failure modes worth knowing about:

- **Unanchorable parts** — if the entire part consists of U+FFFD and/or combining marks (i.e. the tokenizer produced nothing positionable), the part is silently dropped. The source bytes it represented are still preserved in chunk text, because chunks span from their first part's `start` to their last part's `end` and gaps between parts are absorbed forward by `getChunk` (see "Chunk Coverage and Positions" above).
- **Mutating splitters** — if a part has anchorable graphemes but none of them are found in the input (e.g. a splitter that lowercases or strips accents), the library throws. Splitters must not transform tokens.

### Supported tokenizers (and a known limitation)

The anchoring model above assumes a splitter whose **decoded part length equals the source span it consumed**. Concretely:

- ✅ `text.split('')`, `text.split(/\s+/)`, sentence/line regex splitters — preserve source bytes verbatim.
- ✅ `tiktoken` (OpenAI cl100k, ada-002, gpt-4o, etc.) — substitutes exactly one U+FFFD per undecodable byte, so length matches source span.
- ⚠️ Embedding models whose tokenizer pipeline **normalizes during decode** (e.g. `gte-small`, `bge-small`, uncased BERT-style WordPiece — typically loaded via `@huggingface/transformers`) — can produce decoded strings longer than the source bytes they consumed. The cursor advances past the next real source position; subsequent tokens either throw `"Splitter returned a part that could not be located in input"` or anchor in the wrong place. To be precise, it's the _model_'s tokenizer config that drives this (lowercase, accent strip, NFC/NFD); the runtime is just executing what the model ships.

If you're using one of the affected embedding-model tokenizers today, the safest workarounds are:

1. Use a 1:1 tokenizer for chunking (tiktoken is a common choice) even if your embedding model is from elsewhere. Most embedding models don't require their own tokenizer for _splitting_ — only for tokenization at inference.
2. Wrap your splitter to pad/trim decoded output to match source length before returning.

Expanding tolerance for length-inflating tokenizers is tracked in [docs/tokenizer-length-inflation.md](docs/tokenizer-length-inflation.md) — it's a planned future enhancement, not a permanent constraint. Real-world regression fixtures for this case live in [test/split.test.js](test/split.test.js) and can be exercised with `B7_TEST=1 npm test` (lazy-loads the `gte-small` model on demand; plain `npm test` doesn't touch it).

When parts are gathered into chunks, this means that some chunks may _undercount_ the number of tokens the splitter produced — there can be more semantic tokens in a chunk than `chunkSize` specifies. In a simple test on 10MB of blog post content using the `tiktoken` tokenizer, 99.6% of parts matched the input on tier 1. If your downstream has a hard token limit (like an embedding API's max tokens), apply a small `chunkSize` discount to accommodate multibyte undercounting.

Let's take a quick look at multibyte handling with some emojis and a `tiktoken`-based splitter:

```js
const text = `
A noiseless 🤫 patient spider, 🕷️
I mark'd where on a little 🏔️ promontory it stood isolated,
Mark'd how to explore 🔍 the vacant vast 🌌 surrounding,
`;

const chunks = split(text, {
  chunkSize: 15,
  chunkOverlap: 2,
  chunkStrategy: "paragraph",
  splitter: tokenSplitter, // from examples above
});

console.log(JSON.stringify(chunks, null, 2));
// =>
[
  {
    text: "A noiseless 🤫 patient spider, 🕷️\nI mark'd where on a",
    start: 1,
    end: 55,
  },
  {
    text: " on a little 🏔️ promontory it stood isolated,\nMark'd how to",
    start: 50,
    end: 110,
  },
  {
    text: " how to explore 🔍 the vacant vast 🌌 surrounding,\n",
    start: 103,
    end: 154,
  },
];
```

The leading `\n` in the input doesn't appear in any chunk — paragraph mode strips leading whitespace from each paragraph and the very first chunk has no previous chunk to extend back into. See "Chunk Coverage and Positions" above.

Ultimately, this approach represents a tradeoff: while some higher-level Unicode data may be under counted during the splitting process, it ensures that chunk start/end positions can be reliably determined with any user-supplied splitter function, preventing malformed chunks and internal errors.

## License

MIT
