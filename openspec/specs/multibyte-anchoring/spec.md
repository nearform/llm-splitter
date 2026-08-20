## Purpose

The multibyte-anchoring capability maps each splitter part back to a `start`/`end` position
in the original source, correctly handling multibyte Unicode (emoji, CJK, accented Latin,
combining marks) and tokenizers that emit U+FFFD replacement characters when a token
straddles a multi-byte sequence. It defines the three-tier locate strategy and the boundary
of which tokenizers are supported.

## Requirements

### Requirement: Three-tier locate strategy

The system SHALL anchor each part against the source using three tiers, cheapest first:
(1) `startsWith(part, cursor)` for a byte-preserving splitter whose cursor sits exactly on
the part; (2) `indexOf(part, cursor)` for a byte-preserving splitter that drops bytes
between parts; (3) `indexOf(firstAnchorGrapheme(part), cursor)` for a byte-mutating splitter
that emits U+FFFD, walking the part's graphemes to the first anchorable one (not U+FFFD, not
a combining mark or variation selector).

Regardless of which tier located the part, the system SHALL set `end = start + part.length`
clamped to input length, and SHALL advance the cursor to that `end`. This length-based
advance is what assumes decoded length equals consumed source span (see "Supported
tokenizer boundary").

#### Scenario: Tier 1 — cursor on the part

- **WHEN** a byte-preserving splitter (e.g. the character or tiktoken happy path) leaves the cursor exactly on the next part
- **THEN** the part is anchored via `startsWith` at the cursor

#### Scenario: Tier 2 — dropped bytes between parts

- **WHEN** a splitter drops bytes between parts (e.g. `text.split(/\s+/)` discarding whitespace) so the cursor lands in the gap
- **THEN** the whole part is located verbatim via `indexOf` forward from the cursor

#### Scenario: Tier 3 — replacement characters present

- **WHEN** a splitter emits U+FFFD for a token that straddles a multi-byte sequence (e.g. tiktoken on emoji)
- **THEN** the part is anchored on its first anchorable grapheme

#### Scenario: Cursor advance is length-based in every tier

- **WHEN** a part has been located by any of the three tiers
- **THEN** `end` is `start + part.length` clamped to input length and the cursor advances to `end`

### Requirement: Unanchorable parts are dropped but bytes preserved

When an entire part consists of U+FFFD and/or combining marks (nothing positionable), the
system SHALL silently drop that part while preserving its source bytes in chunk text,
because chunks span from their first part's `start` to their last part's `end` and gaps
between parts are absorbed forward.

#### Scenario: Fully unanchorable part

- **WHEN** a part contains only replacement characters and/or combining marks
- **THEN** the part is dropped from anchoring but the source code units it represented remain within the enclosing chunk's range

### Requirement: Mutating splitters are unsupported

Splitters MUST NOT transform token content. When a part's first anchorable grapheme cannot
be found in the source from the cursor onward, the system SHALL throw. When that grapheme
_is_ found but at a position unrelated to the part's true origin — the common case for a
lowercasing or accent-stripping splitter, whose mutated parts often still match some later
occurrence — the system SHALL anchor there, producing an incorrect position with no error.
Callers MUST NOT rely on a mutating splitter failing loudly.

#### Scenario: Anchorable but absent part

- **WHEN** a part's anchorable graphemes do not occur in the source from the cursor onward
- **THEN** `split` throws indicating the part could not be located in input

#### Scenario: Mutated part matches a later occurrence

- **WHEN** a lowercasing splitter emits `"hi"` for source `"Hi"` and a lowercase `h` occurs later in the input
- **THEN** the part anchors on that later `h`, yielding an incorrect `start` and no error

### Requirement: Anchoring positions parts, it does not police boundaries

Grapheme segmentation is used only to choose an anchor _inside a part_ during Tier 3. It
carries no guarantee about chunk boundaries. The system SHALL faithfully reproduce whatever
units the splitter returns, so when a splitter emits parts that are fragments of a grapheme
cluster — which the default `text.split('')` does for any astral character, one UTF-16 code
unit at a time — chunk boundaries MAY fall inside a grapheme cluster or between the halves of
a surrogate pair. Choosing units that are meaningful for the caller's model is the splitter's
responsibility, not the library's.

The positional contract still holds in that case: `chunk.text === getChunk(input, start, end)`
for every chunk, and coverage is unbroken.

#### Scenario: Default splitter over an astral character

- **WHEN** `split("👋🏻 hi", { chunkSize: 1 })` runs with the default character splitter
- **THEN** chunks carry individual UTF-16 code units, including lone surrogates, each with correct `start`/`end` and full coverage

### Requirement: Supported tokenizer boundary

The system SHALL correctly position any splitter whose decoded part length equals the source
span it consumed — including `text.split('')`, whitespace and sentence/line regex splitters,
and `tiktoken` (which substitutes exactly one U+FFFD per undecodable byte). Tokenizers whose
pipeline normalizes during decode (e.g. `gte-small`, `bge-small`, uncased WordPiece via
`@huggingface/transformers`) are a known limitation: they can inflate decoded length and
cause a throw or mis-anchoring. Expanding support for these is tracked as future work.

#### Scenario: Length-preserving tokenizer

- **WHEN** a splitter's decoded part length equals its consumed source span (char, whitespace, sentence, tiktoken)
- **THEN** every part anchors to a correct source position

#### Scenario: Length-inflating tokenizer (known limitation)

- **WHEN** a normalizing embedding-model tokenizer produces a decoded part longer than its source span
- **THEN** the cursor may advance past the next real position, causing a throw or mis-anchor — the documented, tracked limitation
