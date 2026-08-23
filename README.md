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
- 🎯 **Exact Positions**: A splitter that knows its offsets can report them, skipping the anchoring search entirely
- 📝 **Typed**: Authored in JS with JSDoc annotations; ships `.d.ts` type definitions

## Installation

```sh
$ npm install llm-splitter
```

## Usage

```js
import { split, getChunk } from "llm-splitter";
```

TypeScript consumers can also import the types. `Chunk` is the element type of the array
`split()` returns; `SplitOptions` is its second argument, useful for typing a wrapper.

```ts
import type { Chunk, SplitOptions } from "llm-splitter";
```

## API

### `split(input, options)`

Splits text into chunks based on a custom splitter function.

Each chunk carries positional data (`start` and `end`) that can retrieve the chunk string
(or array of strings) later via `getChunk()`. This is for the common scenario of storing
embeddings for a chunk in a database (e.g. `pgvector`) without also storing the chunk text,
yet still being able to recover it from the original input.

#### Parameters

- `input` (string|string[]) - The text or array of texts to split
- `options` (object) - Configuration options
  - `chunkSize` (number) - Maximum number of tokens per chunk (default: `512`)
  - `chunkOverlap` (number) - Number of overlapping tokens between chunks (default: `0`)
  - `chunkStrategy` (string) - Grouping preference for chunks (default: `"character"`)
  - `splitter` (function) - Function to split text into tokens (default: character-by-character)

Notes:

- `input` must be a `string` or an array whose elements are all strings; anything else throws `TypeError`.
- `chunkSize` must be a positive integer ≥ 1.
- `chunkOverlap` must be a non-negative integer ≥ 0, and less than `chunkSize`.
- `splitter` must return an array whose elements are strings, or objects of the form
  `{ text, start }` reporting where each part came from (see "Reported positions"). Not
  returning an array throws `TypeError`, as does a `{ text, start }` object with a non-string
  `text` or an out-of-range `start`. An element that is neither a string nor an object throws
  plain `Error` — as do an invalid `chunkSize`, `chunkOverlap`, or `chunkStrategy`, and a
  `splitter` that isn't a function.
- `splitter` functions may **omit** text but must not **mutate** it. Splitting on spaces is
  fine (`(t) => t.split(" ")`); uppercasing the results is not. A mutating splitter throws
  when a token can't be located — but it can also anchor at a wrong position with no error,
  so don't rely on it failing loudly (see "Multibyte / Unicode Strings").
- Zero-length tokens are skipped: they anchor nowhere and don't count toward `chunkSize`.
- Array element boundaries are always token boundaries — a token never spans two elements.
- Input with no anchorable content yields no chunks: `split("")` and `split([])` return `[]`,
  as does a whitespace-only input under `chunkStrategy: "paragraph"`.
- Sample `splitter` functions:
  - Character: `text => text.split('')` (default)
  - Word: `text => text.split(/\s+/)`
  - Sentence: `text => text.split(/[.!?]+/)`
  - Line: `text => text.split(/\n/)`

#### Returns

An array of chunk objects:

```js
{
  text: string | string[], // The chunk text
  start: number,           // Start position in the original text
  end: number              // End position in the original text
}
```

`text` follows the input you passed: `split(str)` gives chunks whose `text` is a `string`,
`split(arr)` gives chunks whose `text` is a `string[]`. TypeScript consumers get that
narrowing automatically; `getChunk` narrows the same way. Passing a value typed
`string | string[]` still works and still returns the union.

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

The default `chunkStrategy: "character"` fits as many tokens as it can into each chunk.
`chunkStrategy: "paragraph"` instead fits as many whole _paragraphs_ (delimited by `\n\n` or
a string array boundary) as it can. When the current chunk already holds a complete paragraph
and the next one wouldn't fit, the chunk is emitted early so that paragraph can start a fresh
one — which tends to keep more context together for RAG and similar uses.

Whole paragraphs are a _preference_, not a guarantee. A paragraph is still split across
chunks when:

- it has more tokens than `chunkSize` on its own, or
- `chunkOverlap > 0` and tokens carried over from the previous chunk leave too little room.
  Carried-over tokens don't count as a paragraph boundary. If keeping paragraphs whole
  matters more than overlap context, use `chunkOverlap: 0`.

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
const chunks = split(texts, {
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

Extracts a chunk of text from the original input by position. For array `input` the positions
are treated as if all elements were concatenated into one long string, so the returned result
is an array whose first and/or last element may be a substring of that item's text.

#### Parameters

- `input` (string|string[]) - The original input text or array of texts
- `start` (number) - Start position in the original text
- `end` (number) - End position in the original text

#### Returns

- `string` - For single string input
- `string[]` - For array of strings input

Notes:

- Positions are clamped, not validated: a range outside the input returns `""` (string) or
  `[]` (array) rather than throwing, and `start`/`end` below `0` are treated as `0`. These are
  _not_ `String.prototype.slice` semantics — `getChunk("hello", 0, -2)` is `""`, while
  `"hello".slice(0, -2)` is `"hel"`.
- Every element of an array `input` must be a string, whether or not it falls inside
  `[start, end)`; a non-string element anywhere throws `TypeError`.

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

#### Sentences

```js
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

#### Reported positions

A splitter that returns bare strings leaves `split()` to work out where each part came from by
searching the source. A splitter that already knows — a tokenizer exposing offset mappings, or
any splitter tracking its own cursor — can say so instead. Return `{ text, start }` in place of
a bare string and that offset is used as given, with no search:

```js
split("alpha, beta", {
  chunkSize: 1,
  splitter: () => [
    { text: "alpha", start: 0 },
    { text: "beta", start: 7 },
  ],
});
// =>
[
  { text: "alpha, ", start: 0, end: 7 },
  { text: "beta", start: 7, end: 11 },
];
```

The two forms mix freely in one array, so a splitter can report only the offsets it is sure of
and leave the rest to the search. `start` is a UTF-16 code unit offset into the string the
splitter was handed — under `chunkStrategy: "paragraph"` that is a single paragraph, not the
whole input.

Offsets are checked for possibility, not correctness: a `start` that is fractional, negative,
past the end of the input, or behind the previous part throws `TypeError`, but `text` is never
compared against the source there. A merely wrong offset is used as given, and the splitter
owns that.

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

`start` and `end` index the source as one continuous run of UTF-16 code units. For an array
input that is the elements concatenated **with no separator**, so the total length is the sum
of the element lengths, _not_ the array's own `length`.

Coverage is lossless from `chunks[0].start` onward: every code unit in
`[chunks[0].start, totalLength)` belongs to at least one chunk,
`chunks[i].end >= chunks[i+1].start` for every adjacent pair (`>=` because `chunkOverlap` may
make them overlap), and the last chunk's `end` is exactly `totalLength`. So "which chunk owns
position 12?" always has an answer — which is the point, for RAG citations, highlighting, and
re-chunking.

What that costs you:

- **Chunk ends may carry trailing whitespace.** Code units a splitter dropped are absorbed
  into the _previous_ chunk by extending its `end`, so a chunk's `text` can end in `"\n\n"`.
  Trim it if you don't want it — the reverse isn't possible without re-reading the source.
- **Code units before `chunks[0].start` are uncovered.** Leading whitespace in paragraph mode
  has no previous chunk to extend back into. This is the only gap.
- **Offsets are code units, not characters.** A typical emoji occupies two, a CJK character
  one, and a boundary can land inside a surrogate pair.

### Multibyte / Unicode Strings

Tokenizers that split byte streams without regard to character boundaries are problematic for
multibyte text (as noted by
[other text splitting libraries](https://js.langchain.com/docs/how_to/split_by_token/)). When
`tiktoken` decodes a token straddling a multi-byte sequence, the result contains U+FFFD
replacement characters — and `llm-splitter` still maps that part back to a `start`/`end` in the
original input, by searching the source for it.

That search is exact when a part's decoded length equals the source span it consumed:

- ✅ **Byte-preserving splitters** — `text.split('')`, `text.split(/\s+/)`, sentence and line
  regexes, and `tiktoken` (cl100k, ada-002, gpt-4o), which substitutes exactly one U+FFFD per
  undecodable byte.
- ⚠️ **Tokenizers that normalize during decode** — `gte-small`, `bge-small`, and uncased
  BERT-style WordPiece, typically loaded via `@huggingface/transformers`. Lowercasing, accent
  stripping, and `##` prefixes make a decoded part longer than the span it consumed, so the
  cursor overshoots and later parts throw or land in the wrong place. It's the _model_'s
  tokenizer config that decides this, not the runtime.
- ❌ **Mutating splitters** — rewriting token content is unsupported and can fail quietly.
  `split()` throws when a part is nowhere in the source, but a lowercased `"hi"` will happily
  anchor on some later `h` with no error.

For an affected tokenizer, chunk with a 1:1 tokenizer (tiktoken is a common choice) even if
your embedding model is from elsewhere. Failing that, apply the same normalization to the input
and split the normalized text, accepting that positions then index that text rather than your
original. Padding decoded parts back to source length is not enough — it repairs the cursor
arithmetic, not the mutation. Wider support is tracked in
[openspec/changes/tokenizer-length-inflation/](openspec/changes/tokenizer-length-inflation/).

#### Known limitations

A search is inference, so even a ✅ splitter can anchor a part a code unit or two early — when
a multi-character delimiter it dropped contains a copy of the part that follows, or when your
source itself holds a literal U+FFFD, common in scraped and mojibake-recovered text. Those
characters join the following chunk instead of the preceding one; coverage and
`chunk.text === getChunk(input, start, end)` still hold, and `chunkOverlap` softens the effect.
A part with nothing positionable in it at all — every code unit a U+FFFD or a combining mark —
is dropped, its source absorbed into the neighboring chunk.

Single-character delimiters and character-class regexes (`/\s+/`, `/[.!?]+/`) can't reach any of
this: a part never contains a character the splitter splits on. Neither can `tiktoken` or
`text.split('')`, which drop nothing between parts. A splitter that reports its own offsets is
exempt by construction — see "Reported positions". Full model and measured residuals in
[openspec/specs/multibyte-anchoring/spec.md](openspec/specs/multibyte-anchoring/spec.md).

#### Token undercounting

Because unanchorable parts are dropped, a chunk may hold more semantic tokens than `chunkSize`
specifies. On 10MB of blog content with `tiktoken`, 99.6% of parts anchored on an exact match
at the cursor. If your downstream has a hard token limit (an embedding API's max tokens, say),
apply a small `chunkSize` discount.

#### Example

Emoji, paragraph mode, and overlap together — note the leading `\n` appears in no chunk,
because paragraph mode strips leading whitespace and the first chunk has no previous chunk to
extend back into.

<details>
  <summary>See example...</summary>

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
    text: "A noiseless 🤫 patient spider, 🕷️\nI mark'd where on",
    start: 1,
    end: 53,
  },
  {
    text: " where on a little 🏔️ promontory it stood isolated,\nMark'd",
    start: 44,
    end: 103,
  },
  {
    text: "Mark'd how to explore 🔍 the vacant vast 🌌 surrounding,\n",
    start: 97,
    end: 154,
  },
];
```

</details>

## License

MIT
