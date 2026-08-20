## Purpose

The chunking capability is the library's core `split(input, options)` entry point. It
divides a string (or array of strings) into size-bounded, optionally overlapping chunks
suitable for LLM vectorization and RAG pipelines, using a single-pass greedy algorithm and
a pluggable tokenizer ("splitter"). Each emitted chunk carries its text plus `start`/`end`
source positions (see the `chunk-coverage` capability for the positional contract).

## Requirements

### Requirement: Default character splitter

The system SHALL split the input character-by-character when no `splitter` option is
provided, using `(text) => text.split("")` as the default.

#### Scenario: No splitter option supplied

- **WHEN** `split(input)` is called with no `splitter` option
- **THEN** the input is tokenized into individual characters before chunking

### Requirement: Configurable chunk size

The system SHALL group splitter parts into chunks of at most `chunkSize` parts, defaulting
to `512`. `chunkSize` counts splitter _parts_ (tokens), not source characters.

#### Scenario: Default chunk size

- **WHEN** `split(input)` is called with no `chunkSize` option
- **THEN** each chunk contains at most 512 splitter parts

#### Scenario: Custom chunk size

- **WHEN** `split(input, { chunkSize: 10 })` is called
- **THEN** each chunk contains at most 10 splitter parts

### Requirement: Configurable chunk overlap

The system SHALL allow adjacent chunks to share trailing parts via `chunkOverlap`,
defaulting to `0`. `chunkOverlap` counts parts and MUST be less than `chunkSize`.

#### Scenario: Default no overlap

- **WHEN** `split(input)` is called with no `chunkOverlap` option
- **THEN** adjacent chunks share no parts

#### Scenario: Non-zero overlap

- **WHEN** `split(input, { chunkSize: 10, chunkOverlap: 3 })` is called
- **THEN** each chunk after the first repeats the last 3 parts of the previous chunk

### Requirement: Custom splitter contract

The system SHALL accept a custom `splitter` function that maps a string to an array of
parts. A splitter MAY drop source bytes between parts (e.g. whitespace) but MUST NOT mutate
token content. Mutating splitters are unsupported and MAY fail either loudly or silently —
see the `multibyte-anchoring` capability for the exact outcomes.

#### Scenario: Byte-dropping splitter

- **WHEN** a whitespace splitter such as `(t) => t.split(/\s+/)` is supplied
- **THEN** chunks are formed from the non-whitespace parts and positions still anchor to the source

#### Scenario: Mutating splitter is unsupported

- **WHEN** a splitter transforms token content (e.g. lowercasing or accent-stripping)
- **THEN** `split` throws if the part cannot be located at all, but MAY instead anchor at a wrong position if the mutated part matches elsewhere in the source

### Requirement: Zero-length parts are skipped

The system SHALL ignore zero-length strings returned by a splitter: they anchor to no source
position and SHALL NOT count toward `chunkSize`. The source code units around them stay
covered by the surrounding parts' chunk (see `chunk-coverage`).

#### Scenario: Splitter emits empty strings

- **WHEN** a splitter returns empty parts (e.g. `(t) => t.split(",")` on `"a,,b"`, yielding `["a", "", "b"]`)
- **THEN** only the non-empty parts are counted and anchored, so `chunkSize: 2` packs `"a"` and `"b"` into one chunk spanning the whole source

### Requirement: Array element boundaries are token boundaries

The system SHALL tokenize each element of an array input independently, so that no token
ever spans two array elements, regardless of `chunkStrategy`. Positions remain offsets into
the elements' concatenation.

#### Scenario: Token never spans two elements

- **WHEN** `split(["ab", "cd"], options)` is called
- **THEN** the splitter is applied to `"ab"` and `"cd"` separately and no emitted part covers code units from both

### Requirement: Input with no anchorable content yields no chunks

The system SHALL return an empty array when the input contains nothing to anchor: an empty
string, an empty array, an array of empty strings, or — under `chunkStrategy: "paragraph"` —
input consisting only of whitespace, which paragraph trimming removes before anchoring. In
`"character"` strategy whitespace-only input still anchors and yields one chunk.

#### Scenario: Empty string or empty array

- **WHEN** `split("")` or `split([])` is called
- **THEN** the result is `[]`

#### Scenario: Whitespace-only input per strategy

- **WHEN** `split("   ")` is called with `chunkStrategy: "paragraph"` and then with `chunkStrategy: "character"`
- **THEN** paragraph strategy returns `[]` while character strategy returns a single chunk covering the whitespace

### Requirement: Argument validation

The system SHALL validate its arguments before doing any work and SHALL throw on invalid
input. `chunkSize` MUST be an integer of at least `1`; `chunkOverlap` MUST be an integer of
at least `0` and MUST be less than `chunkSize`; `splitter` MUST be a function that returns an
array of strings; `input` MUST be a string or an array whose every element is a string.

Option and splitter-contract violations SHALL throw `Error`, while type violations of `input`
and of the splitter's return value SHALL throw `TypeError`.

#### Scenario: Invalid chunkSize

- **WHEN** `chunkSize` is not an integer (e.g. `1.5`, `"invalid"`) or is less than `1` (e.g. `0`, `-1`)
- **THEN** `split` throws an `Error`

#### Scenario: Invalid chunkOverlap

- **WHEN** `chunkOverlap` is not an integer, is negative, or is greater than or equal to `chunkSize`
- **THEN** `split` throws an `Error`

#### Scenario: Splitter is not a function

- **WHEN** `splitter` is supplied but is not a function
- **THEN** `split` throws an `Error`

#### Scenario: Input is not a string or array of strings

- **WHEN** `input` is `null`, a number, or an array containing a non-string element
- **THEN** `split` throws a `TypeError`

#### Scenario: Splitter returns a non-array

- **WHEN** a splitter returns something other than an array (e.g. a string)
- **THEN** `split` throws a `TypeError`

#### Scenario: Splitter returns a non-string part

- **WHEN** a splitter returns an array containing a non-string part
- **THEN** `split` throws an `Error`

#### Scenario: Splitter errors propagate

- **WHEN** the splitter itself throws
- **THEN** `split` propagates that error unchanged

### Requirement: Chunk strategy selection

The system SHALL support a `chunkStrategy` of `"character"` (default) or `"paragraph"`, and
SHALL reject any other value.

#### Scenario: Default character strategy

- **WHEN** `split(input)` is called with no `chunkStrategy` option
- **THEN** the input is chunked as a single continuous stream of parts

#### Scenario: Invalid strategy rejected

- **WHEN** `split(input, { chunkStrategy: "sentence" })` is called
- **THEN** `split` throws because the strategy is not one of the supported values

### Requirement: Paragraph strategy boundaries

In `"paragraph"` strategy the system SHALL treat the paragraph delimiter `"\n\n"` and array
element boundaries as paragraph breaks, and SHALL trim leading and trailing whitespace of a
paragraph before anchoring so that chunk starts land on real content.

Paragraphs are _preferred_ to stay whole, not guaranteed to: the system SHALL emit the
current chunk early when it already contains a paragraph boundary **and** appending the
entire next paragraph would exceed `chunkSize`. Paragraphs that fit together SHALL be
packed into the same chunk, and a paragraph with more parts than `chunkSize` SHALL be split
across as many chunks as it needs.

Parts carried over by `chunkOverlap` SHALL NOT count as a paragraph boundary in the chunk
they are carried into — the boundary belongs to the chunk that was just emitted. A paragraph
that would fit in an empty chunk MAY therefore still be split when overlap parts occupy part
of the chunk.

#### Scenario: Small paragraphs share a chunk

- **WHEN** two consecutive paragraphs together contain no more than `chunkSize` parts
- **THEN** both are packed into the same chunk, which therefore spans the paragraph boundary

#### Scenario: Next paragraph would overflow

- **WHEN** the current chunk already contains a paragraph boundary and appending the whole next paragraph would exceed `chunkSize`
- **THEN** the current chunk is emitted first so the next paragraph begins a new chunk

#### Scenario: Paragraph larger than chunkSize

- **WHEN** a single paragraph contains more parts than `chunkSize`
- **THEN** it is split across consecutive chunks

#### Scenario: Overlap parts split an otherwise-whole paragraph

- **WHEN** a paragraph with fewer parts than `chunkSize` follows a chunk that carried `chunkOverlap` parts forward, and overlap plus paragraph exceeds `chunkSize`
- **THEN** the paragraph is split, whereas the same input with `chunkOverlap: 0` keeps it whole

### Requirement: Chunk result shape

The system SHALL return an array of chunks, each an object `{ text, start, end }`, where
`text` matches the input type (string for string input, array for array input) and
`start`/`end` are UTF-16 code-unit offsets into the source.

#### Scenario: Result objects

- **WHEN** `split(input, options)` returns chunks
- **THEN** each chunk exposes `text`, a numeric `start`, and a numeric `end`
