## MODIFIED Requirements

### Requirement: Three-tier locate strategy

The system SHALL anchor each part against the source using three tiers, cheapest first:
(1) `startsWith(part, cursor)` for a byte-preserving splitter whose cursor sits exactly on
the part; (2) `indexOf(part, cursor)` for a byte-preserving splitter that drops bytes
between parts; (3) `indexOf(firstAnchorGrapheme(part), cursor)` for a byte-mutating splitter
that emits U+FFFD, walking the part's graphemes to the first anchorable one (not U+FFFD, not
a combining mark or variation selector).

The system SHALL skip Tier 2 when it provably cannot succeed. A part containing U+FFFD
cannot be a substring of a source that contains no U+FFFD, so when the part contains the
replacement character and the source does not, the system SHALL proceed directly to Tier 3.
This is an equivalence, not an approximation: the skipped search could only have reported
"not found". U+FFFD is the only character a supported splitter can introduce that was not in
the source (see "Supported tokenizer boundary"), so no other part content admits the same
inference.

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

#### Scenario: Tier 2 skipped for a part the source cannot contain

- **WHEN** a part contains U+FFFD and the source string contains no U+FFFD
- **THEN** Tier 2 is not attempted and the part is anchored by Tier 3, yielding the same position it would have without the skip

#### Scenario: Tier 2 attempted when the source itself contains U+FFFD

- **WHEN** a part contains U+FFFD and the source string also contains U+FFFD
- **THEN** Tier 2 is attempted as normal, because the part may exist verbatim in the source

#### Scenario: Cursor advance is length-based in every tier

- **WHEN** a part has been located by any of the three tiers
- **THEN** `end` is `start + part.length` clamped to input length and the cursor advances to `end`

## ADDED Requirements

### Requirement: Anchoring cost is linear in input length

For a supported splitter, the system SHALL anchor parts in time linear in the length of the
input, for every chunk strategy. No part SHALL trigger a search whose outcome is already
determined, because a per-part search proportional to the remaining input makes the whole
split quadratic — a document that is 10x larger must not cost ~100x more to chunk.

This is a behavioral guarantee, not an implementation note: callers chunk whole documents,
and a quadratic term makes large multi-byte inputs unusable rather than merely slow.

#### Scenario: Doubling input size roughly doubles anchoring time

- **WHEN** the same U+FFFD-emitting tokenizer splitter is run over inputs of size n and 2n in `character` strategy
- **THEN** the time taken for 2n is a small constant multiple of the time for n, not a quadratic multiple

#### Scenario: Fully unanchorable parts do not pay for grapheme segmentation

- **WHEN** a part consists entirely of U+FFFD
- **THEN** it is recognized as unanchorable without segmenting it into graphemes
