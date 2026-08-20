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

#### Scenario: Small paragraphs share a chunk

- **WHEN** two consecutive paragraphs together contain no more than `chunkSize` parts
- **THEN** both are packed into the same chunk, which therefore spans the paragraph boundary

#### Scenario: Next paragraph would overflow

- **WHEN** the current chunk already contains a paragraph boundary and appending the whole next paragraph would exceed `chunkSize`
- **THEN** the current chunk is emitted first so the next paragraph begins a new chunk

#### Scenario: Paragraph larger than chunkSize

- **WHEN** a single paragraph contains more parts than `chunkSize`
- **THEN** it is split across consecutive chunks

### Requirement: Chunk result shape

The system SHALL return an array of chunks, each an object `{ text, start, end }`, where
`text` matches the input type (string for string input, array for array input) and
`start`/`end` are UTF-16 code-unit offsets into the source.

#### Scenario: Result objects

- **WHEN** `split(input, options)` returns chunks
- **THEN** each chunk exposes `text`, a numeric `start`, and a numeric `end`
