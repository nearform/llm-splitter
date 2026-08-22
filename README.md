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
- 📝 **Typed**: Authored in JS with JSDoc annotations; ships `.d.ts` type definitions for full editor and TypeScript consumer support

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
- `splitter` must return an array whose elements are strings, or objects of the form `{ text, start }` reporting where each part came from (see "Reported positions" below). Returning a non-array throws `TypeError`, and returning an element that is neither throws.
- `splitter` functions can omit text when splitting, but should not mutate the emitted tokens. This means that splitting by spaces is fine (e.g. `(t) => t.split(" ")`) but splitting and changing text is **not allowed** (e.g. `(t) => t.split(" ").map((x) => x.toUpperCase())`). A mutating splitter throws at runtime when a token can't be located in the source — but it can also anchor at a wrong position with no error, so don't rely on it failing loudly (see "Multibyte / Unicode Strings" below).
- Zero-length tokens returned by a `splitter` are skipped: they anchor nowhere and don't count toward `chunkSize`.
- Array element boundaries are always token boundaries — each element is tokenized on its own, so a token never spans two array elements.
- Input with no anchorable content yields no chunks: `split("")` and `split([])` both return `[]`, as does a whitespace-only input under `chunkStrategy: "paragraph"` (paragraph mode trims whitespace, leaving nothing to anchor).
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

`text` follows the input you passed: `split(str)` gives chunks whose `text` is a `string`,
`split(arr)` gives chunks whose `text` is a `string[]`. TypeScript consumers get that
narrowing automatically and don't need to re-check the union — `getChunk` narrows the same
way. Passing a value typed `string | string[]` still works and still returns the union.

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

By default, we assemble chunks with as many tokens fit in. This default is considered the `chunkStrategy = "character"`. Another option is to fit as many whole _paragraphs_ (denoted by string array end or `\n\n` characters) as we can into a chunk. When the current chunk already holds a complete paragraph and the next paragraph wouldn't fit in what's left, we emit the chunk early so that paragraph can start a fresh one. This approach allows you to keep paragraph structures more contained within chunks which may yield advantageous context outcomes for your upstream usage (in a RAG app, etc).

Whole paragraphs are a _preference_, not a guarantee. A paragraph still gets split across as many chunks as it needs when:

- it has more tokens than `chunkSize` on its own, or
- `chunkOverlap > 0` and the tokens carried over from the previous chunk leave too little room. Carried-over overlap tokens don't count as a paragraph boundary, so a paragraph that would fit in an empty chunk can still be split. If keeping paragraphs whole matters more than overlap context, use `chunkOverlap: 0`.

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

Extracts a specific chunk of text from the original input based on start and end positions. For array `input` the positions are treated as if all elements in the array were concatenated into a single long string.

Note that for arrays, the returned result will be an array and that the first and/or last element of the array may be a substring of that array item's text.

#### Parameters

- `input` (string|string[]) - The original input text or array of texts
- `start` (number) - Start position in the original text
- `end` (number) - End position in the original text

#### Returns

- `string` - For single string input
- `string[]` - For array of strings input

Notes:

- Positions are clamped, not validated: a range that falls outside the input returns `""` (string input) or `[]` (array input) rather than throwing, and `start`/`end` below `0` are treated as `0`. A negative `end` therefore yields an empty result — this is _not_ `String.prototype.slice` semantics (`getChunk("hello", 0, -2)` is `""`, while `"hello".slice(0, -2)` is `"hel"`).
- Every element of an array `input` must be a string, whether or not it falls inside `[start, end)`; a non-string element anywhere throws `TypeError`.

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

### `delimiterSplitter(delimiter)`

Builds a `splitter` that splits on `delimiter` and reports each part's exact source offset, so `split()` positions those parts from knowledge rather than by searching for them. Empty parts are omitted. See "Reported positions" below for why that matters.

#### Parameters

- `delimiter` (string) - The separator to split on. Must be a non-empty string; anything else throws `TypeError`.

#### Returns

`(input: string) => Array<{ text: string, start: number }>` — a splitter you can pass straight to `split()`.

#### Examples

```js
delimiterSplitter(", ")("alpha, beta");
// =>
[
  { text: "alpha", start: 0 },
  { text: "beta", start: 7 },
];
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

#### Reported positions

A splitter returns strings, so `split()` has to work out where each part came from by searching the source — and a search can be wrong. Splitting `"a...."` on `"..."` gives `["a", "."]`, and that `"."` is at index 4; a search finds the one at index 1, inside the span the delimiter consumed. Nothing in the text recovers this: offsets 1 through 4 all tile the source, and only the splitter knows which is right.

So a splitter that knows its offsets can hand them over. Return `{ text, start }` in place of a bare string and that offset is used as given, with no search:

```js
split("a....", {
  chunkSize: 1,
  splitter: () => [
    { text: "a", start: 0 },
    { text: ".", start: 4 },
  ],
});
```

`delimiterSplitter(delimiter)` does this for the common case:

```js
import { split, delimiterSplitter } from "llm-splitter";

const chunks = split("a....", {
  chunkSize: 1,
  splitter: delimiterSplitter("..."),
});

// =>
[
  { text: "a...", start: 0, end: 4 },
  { text: ".", start: 4, end: 5 },
];
```

The two forms mix freely in one array, so a splitter can report only the offsets it is sure of and leave the rest to the search. `start` is a UTF-16 code unit offset into the string the splitter was handed — under `chunkStrategy: "paragraph"` that is a single paragraph, not the whole input.

Reported offsets are validated for _possibility_, not correctness. A `start` that is fractional, negative, past the end of the input, or behind the previous part throws `TypeError`. But `text` is never compared against the source at `start`, because a byte-mutating tokenizer legitimately returns text that differs from the span it consumed — an offset that is merely wrong is used as given, and the splitter owns that.

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

Positions index the source as one continuous run of code units. For a string input that is just the string; for an array input it is the elements concatenated in order **with no separator**, so the total length is the sum of the element lengths and _not_ the array's own `length`:

```js
const totalLength = Array.isArray(input)
  ? input.reduce((sum, item) => sum + item.length, 0)
  : input.length;
```

`split()` is **lossless on positions** from `chunks[0].start` onward: every UTF-16 code unit of the source at index `p` (where `chunks[0].start <= p < totalLength`) appears in at least one chunk's `[start, end)` range. `start` and `end` are UTF-16 code-unit offsets — so for non-ASCII text a single character may occupy one or two code units (a typical emoji is two; a CJK character is one). Concretely:

- `chunks[i].end >= chunks[i+1].start` for every adjacent pair (`>=` because `chunkOverlap` may make them overlap; without overlap they're equal).
- `chunks[chunks.length - 1].end === totalLength`.

The reason: chunks return `{ start, end }` so downstream code can locate them in the source — for RAG citations, source highlighting, re-chunking, completeness checks, and so on. If `split()` dropped code units that the splitter happened to skip (whitespace, paragraph delimiters, tokens that couldn't be anchored), those positions would belong to no chunk and position-based queries would have gaps in their answers ("which chunk owns position 12?" → none). A consumer who wants trimmed chunk text can trim it themselves — `chunk.text.trim()` for string input, or per element when `text` is a `string[]`; going the other way (we trim, they want the content back) is impossible without re-reading the source. So the library keeps everything.

Practical consequences:

- **Chunk starts are clean.** In `chunkStrategy: "paragraph"` mode, leading whitespace inside a paragraph is stripped before anchoring, so `chunks[i].start` (for `i > 0`) lands on real content.
- **Chunk ends may carry trailing whitespace.** When the splitter drops code units at a paragraph or token boundary, those positions get absorbed into the _previous_ chunk by extending its `end` forward to meet the next chunk's `start`. So a chunk's `text` may end with `"\n\n"` or trailing whitespace — those positions weren't "extra," they were the gap between the splitter's last token in this chunk and the first token in the next.
- **Leading code units before `chunks[0].start` are uncovered.** If the very first paragraph has leading whitespace, those positions appear in no chunk (no previous chunk to extend forward into them). This is the one place coverage is not full.

For LLM input this also tends to help, not hurt: a chunk ending with `"\n\n"` carries an explicit paragraph-boundary signal that the model can read.

### Multibyte / Unicode Strings

Processing text with multibyte Unicode characters (emoji, CJK, accented Latin, combining marks) is problematic for tokenizers that split byte streams without regard to character boundaries (as noted by [other text splitting libraries](https://js.langchain.com/docs/how_to/split_by_token/)). When a tokenizer like `tiktoken` decodes a token that straddles a multi-byte sequence, the result is a JavaScript string containing U+FFFD replacement characters (and sometimes isolated combining marks). `llm-splitter` needs to map each such part back to a `start`/`end` position in the original input.

`llm-splitter` anchors each part against the source string with a three-tier locate strategy (cheapest first):

1. **`startsWith` at cursor** — byte-preserving splitter with the cursor sitting exactly on the next part (the char and tiktoken happy paths).
2. **`indexOf(part)` forward from cursor** — byte-preserving splitter that drops bytes between parts (`text.split(/\s+/)` discards whitespace, so the cursor lands in the gap and tier 1 fails). The part still exists verbatim, so a substring search finds it without allocating. **Skipped for any part containing U+FFFD**: the splitter invented that character, so a verbatim match on it says nothing about where the part came from.
3. **`indexOf(firstAnchorGrapheme(part))` forward from cursor** — byte-mutating splitter (`tiktoken` emitting U+FFFD when a token straddles a multi-byte sequence). Walk the part's [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) graphemes for the first _anchorable_ one (not U+FFFD, not a combining mark or variation selector), locate it in the input, then subtract its offset within the part to get the part's own left edge. Each candidate is verified before it is accepted: the part's non-U+FFFD code units must line up with the source there, or the search moves to the next occurrence. `end` is `start + part.length`, clamped. Chunk boundaries carry no code-point integrity guarantee — `start` can land inside a surrogate pair (see "Chunk Coverage and Positions").

Four limitations worth knowing about. Every one of them is a consequence of _inferring_ a position from text, so a splitter that reports its own offsets is subject to none of them — see "Reported positions" above.

- **Unanchorable parts** — a part consisting entirely of U+FFFD and/or combining marks is dropped, since nothing in it can be positioned. The source it stood for is still covered: gaps between parts are absorbed forward (see "Chunk Coverage and Positions"). A literal U+FFFD in the source is dropped the same way, because a bare U+FFFD is byte-identical whether the splitter invented it or passed it through.
- **Mutating splitters** — splitters must not transform tokens. If a part has anchorable graphemes but none are found in the input (e.g. a splitter that lowercases or strips accents), the library throws. It can only throw when the grapheme is genuinely absent, though: a lowercased `"hi"` will happily anchor on some later `h`, yielding a wrong position with no error. Don't rely on a mutating splitter failing loudly.
- **Tier 2 takes the first verbatim match** — when the span a splitter dropped contains a copy of the part that follows it, the search anchors on that copy and reports a position a few code units early. `split("a....", { splitter: (t) => t.split("...").filter(Boolean) })` puts the `"."` at 1; it is at 4. Plain ASCII, no U+FFFD involved, and the largest of the four in practice. `delimiterSplitter` removes it outright.
- **A literal U+FFFD in your source** — common in scraped and mojibake-recovered text. Skipping tier 2 for U+FFFD-bearing parts stops a manufactured U+FFFD matching an unrelated literal one, which used to throw on ordinary RAG input. Two narrow effects remain, neither affecting coverage or `chunk.text === getChunk(input, start, end)`. **Tier 1** compares only at the cursor, so a literal U+FFFD sitting exactly there may be claimed by a manufactured part — one code unit attributed to the wrong token, and since both are one unit wide nothing after it shifts. **Tier 3** positions mixed parts by grapheme search rather than exact match; candidate verification settles parts with two or more real code units, but a part that is _mostly_ U+FFFD can still anchor a few code units early, so those characters join the following chunk instead of the preceding one. Raising `chunkOverlap` reduces the practical effect, since the shift is a few code units while the overlap is whole tokens.

### Supported tokenizers (and a known limitation)

The anchoring model above assumes a splitter whose **decoded part length equals the source span it consumed**. Concretely:

- ✅ `text.split('')`, `text.split(/\s+/)`, sentence/line regex splitters — preserve source bytes verbatim.
- ✅ `tiktoken` (OpenAI cl100k, ada-002, gpt-4o, etc.) — substitutes exactly one U+FFFD per undecodable byte, so length matches source span. This holds whether or not your source itself contains literal U+FFFD, with the two narrow exceptions described under "Multibyte / Unicode Strings" above. `tiktoken` itself drops nothing between parts, so only the first of the two (a literal U+FFFD at the cursor claiming a manufactured part) applies to it.
- ⚠️ Embedding models whose tokenizer pipeline **normalizes during decode** (e.g. `gte-small`, `bge-small`, uncased BERT-style WordPiece — typically loaded via `@huggingface/transformers`) — can produce decoded strings longer than the source bytes they consumed. The cursor advances past the next real source position; subsequent tokens either throw `"Splitter returned a part that could not be located in input"` or anchor in the wrong place. To be precise, it's the _model_'s tokenizer config that drives this (lowercase, accent strip, NFC/NFD); the runtime is just executing what the model ships.

If you're using one of the affected embedding-model tokenizers today, the safest workarounds are:

1. Use a 1:1 tokenizer for chunking (tiktoken is a common choice) even if your embedding model is from elsewhere. Most embedding models don't require their own tokenizer for _splitting_ — only for tokenization at inference.
2. Wrap your splitter to pad/trim decoded output to match source length before returning.
3. Report positions. The length assumption exists only because `split()` has to infer where a part came from; a splitter that returns `{ text, start }` sidesteps it (see "Reported positions" above).

Expanding tolerance for length-inflating tokenizers is tracked in [openspec/changes/tokenizer-length-inflation/](openspec/changes/tokenizer-length-inflation/) — it's a planned future enhancement, not a permanent constraint. That change records the real-world `gte-small` failure modes and the regression fixtures that will gate the fix.

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

The leading `\n` in the input doesn't appear in any chunk — paragraph mode strips leading whitespace from each paragraph and the very first chunk has no previous chunk to extend back into. See "Chunk Coverage and Positions" above.

Ultimately, this approach represents a tradeoff: while some higher-level Unicode data may be under counted during the splitting process, it ensures that chunk start/end positions can be reliably determined with any user-supplied splitter function, preventing malformed chunks and internal errors.

## License

MIT
