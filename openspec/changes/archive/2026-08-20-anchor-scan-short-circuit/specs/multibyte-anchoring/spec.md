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

For a supported splitter running against a source that contains no U+FFFD, the system SHALL
anchor parts in time linear in the length of the input, for every chunk strategy. No part
SHALL trigger a search whose outcome is already determined, because a per-part search
proportional to the remaining input makes the whole split quadratic — a document that is 10x
larger must not cost ~100x more to chunk.

That precondition is the exact scope of the guarantee, and two cases fall outside it by
design. A source that itself contains U+FFFD makes a U+FFFD-bearing part genuinely findable,
so Tier 2 cannot be skipped and the per-part search stays unbounded. A splitter that mutates
bytes without emitting U+FFFD likewise keeps the unbounded search, and is already unsupported
for correctness reasons (see "Mutating splitters are unsupported").

Within its scope this is a behavioral guarantee, not an implementation note: callers chunk
whole documents, and a quadratic term makes large multi-byte inputs unusable rather than
merely slow.

#### Scenario: Growing the input grows anchoring time proportionally

- **WHEN** the same U+FFFD-emitting tokenizer splitter is run in `character` strategy over inputs of size n and k·n that contain no U+FFFD
- **THEN** the time taken for k·n is roughly k times the time for n, not k² times

#### Scenario: An input whose parts are almost all unanchorable stays linear

- **WHEN** a splitter returns parts that are overwhelmingly nothing but U+FFFD
- **THEN** anchoring time still grows linearly with input length, rather than paying a per-part cost proportional to part length

#### Scenario: Source containing U+FFFD keeps the unbounded search (known limitation)

- **WHEN** the source string itself contains U+FFFD
- **THEN** Tier 2 is attempted for every part as normal and no linearity guarantee applies
