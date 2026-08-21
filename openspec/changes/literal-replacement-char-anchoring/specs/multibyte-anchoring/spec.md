## ADDED Requirements

### Requirement: A literal U+FFFD in the source does not misdirect anchoring

A source string may itself contain U+FFFD — scraped and mojibake-recovered text routinely
does. The system SHALL NOT anchor a part on a U+FFFD that the splitter manufactured by
matching it against an unrelated literal U+FFFD in the source. For a splitter whose decoded
part length equals its consumed source span, the presence of a literal U+FFFD anywhere in
the source SHALL NOT change which position any part anchors to, and SHALL NOT cause a throw
that the same input without that character would not produce.

This is the correctness counterpart to the linearity carve-out in "Anchoring cost is linear
in input length". Both stem from the same precondition, and prior to this change only the
cost half was stated.

A part whose U+FFFD is genuinely present in the source at the cursor's forward position is
a different case and is unaffected: such a part is not manufactured, and the requirement
"Unanchorable parts are dropped but bytes preserved" continues to govern parts that hold
nothing positionable.

#### Scenario: Manufactured U+FFFD does not match a literal one later in the source

- **WHEN** a tokenizer fragments a multi-byte character into parts that each decode to a bare U+FFFD, and the source also contains a literal U+FFFD at a later position
- **THEN** those manufactured parts are dropped as unanchorable rather than anchored on the literal U+FFFD, the cursor stays on real source, and every subsequent part anchors to its correct position

#### Scenario: A literal U+FFFD in the source is position-neutral

- **WHEN** the same input is split twice, once with a literal U+FFFD in the source and once with that character replaced by an ordinary non-replacement character
- **THEN** both splits succeed and the two chunk lists agree on the positions of every part that exists in both

#### Scenario: A part whose replacement char is genuinely in the source still anchors

- **WHEN** a byte-preserving splitter returns a part containing U+FFFD that appears verbatim in the source forward of the cursor
- **THEN** the part anchors at that verbatim position, unchanged from prior behavior

## MODIFIED Requirements

### Requirement: Supported tokenizer boundary

The system SHALL correctly position any splitter whose decoded part length equals the source
span it consumed — including `text.split('')`, whitespace and sentence/line regex splitters,
and `tiktoken` (which substitutes exactly one U+FFFD per undecodable byte). This holds
whether or not the source itself contains literal U+FFFD (see "A literal U+FFFD in the
source does not misdirect anchoring"). Tokenizers whose pipeline normalizes during decode
(e.g. `gte-small`, `bge-small`, uncased WordPiece via `@huggingface/transformers`) are a
known limitation: they can inflate decoded length and cause a throw or mis-anchoring.
Expanding support for these is tracked as future work.

#### Scenario: Length-preserving tokenizer

- **WHEN** a splitter's decoded part length equals its consumed source span (char, whitespace, sentence, tiktoken)
- **THEN** every part anchors to a correct source position

#### Scenario: Length-preserving tokenizer over a source containing U+FFFD

- **WHEN** a length-preserving tokenizer such as `tiktoken` splits a source that contains one or more literal U+FFFD characters
- **THEN** every part still anchors to a correct source position and no throw occurs

#### Scenario: Length-inflating tokenizer (known limitation)

- **WHEN** a normalizing embedding-model tokenizer produces a decoded part longer than its source span
- **THEN** the cursor may advance past the next real position, causing a throw or mis-anchor — the documented, tracked limitation

### Requirement: Anchoring cost is linear in input length

For a supported splitter running against a source that contains no U+FFFD, the system SHALL
anchor parts in time linear in the length of the input, for every chunk strategy. No part
SHALL trigger a search whose outcome is already determined, because a per-part search
proportional to the remaining input makes the whole split quadratic — a document that is 10x
larger must not cost ~100x more to chunk.

That precondition is the exact scope of the guarantee, and two cases fall outside it by
design. A source that itself contains U+FFFD makes a U+FFFD-bearing part genuinely findable,
so Tier 2 cannot be skipped and the per-part search stays unbounded; this is a cost carve-out
only, and anchoring in that case remains correct per "A literal U+FFFD in the source does not
misdirect anchoring". A splitter that mutates bytes without emitting U+FFFD likewise keeps the
unbounded search, and is already unsupported for correctness reasons (see "Mutating splitters
are unsupported").

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
- **THEN** Tier 2 is attempted for every part as normal and no linearity guarantee applies, while anchoring positions remain correct
