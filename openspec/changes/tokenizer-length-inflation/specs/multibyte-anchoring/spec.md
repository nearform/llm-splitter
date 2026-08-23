## MODIFIED Requirements

### Requirement: Supported tokenizer boundary

The system SHALL correctly position any splitter whose decoded part length equals the source
span it consumed — including `text.split('')`, whitespace and sentence/line regex splitters,
and `tiktoken` (which substitutes exactly one U+FFFD per undecodable byte). When the caller
supplies a `sourceNormalize` function, the system SHALL additionally position parts from
normalizing tokenizers (e.g. `gte-small`, `bge-small`, uncased WordPiece via
`@huggingface/transformers`) whose decoded form is lowercased, accent-stripped, or
`##`-prefixed, by comparing normalized source against normalized parts. Without
`sourceNormalize`, such tokenizers remain unsupported and MAY throw or mis-anchor.

Both halves remain subject to the three inference limitations stated in "A literal U+FFFD in
the source does not misdirect anchoring", which apply whether or not the source itself contains
literal U+FFFD and are not exempted by length preservation. `sourceNormalize` does not change
that either: it replaces Tier 3 only, and both the Tier 2 skip for U+FFFD-bearing parts and the
Tier 2 first-verbatim-match limitation are independent of it.

#### Scenario: Length-preserving tokenizer

- **WHEN** a splitter's decoded part length equals its consumed source span (char, whitespace, sentence, tiktoken)
- **THEN** every part anchors to a correct source position whether or not `sourceNormalize` is supplied, except as allowed by the three inference limitations in "A literal U+FFFD in the source does not misdirect anchoring"

#### Scenario: Length-preserving tokenizer over a source containing U+FFFD

- **WHEN** a length-preserving tokenizer such as `tiktoken` splits a source that contains one or more literal U+FFFD characters
- **THEN** no throw occurs, and every part anchors to a correct source position except as allowed by the three exceptions in "A literal U+FFFD in the source does not misdirect anchoring"

#### Scenario: Normalizing tokenizer with sourceNormalize

- **WHEN** a normalizing tokenizer mutates parts (e.g. `"Hi"` → `"hi"`, `"Evän"` → `"evan"`, `"ん"` → `"##ん"`) and the caller supplies a matching `sourceNormalize`
- **THEN** each part anchors to the correct source position via normalized comparison

#### Scenario: Normalizing tokenizer without sourceNormalize

- **WHEN** a normalizing tokenizer mutates parts and no `sourceNormalize` is supplied
- **THEN** the system throws or mis-anchors — the documented, unsupported default

#### Scenario: Length-inflating tokenizer (known limitation)

- **WHEN** a normalizing embedding-model tokenizer produces a decoded part longer than its source span and no `sourceNormalize` is supplied
- **THEN** the cursor may advance past the next real position, causing a throw or mis-anchor — the documented, tracked limitation

## ADDED Requirements

### Requirement: Normalized-comparison Tier 3 anchor

When `sourceNormalize` is supplied, the system SHALL replace the Tier 3 grapheme lookup with a
normalized forward scan that derives a source **span**, not just a start: from the cursor, find
the first source index `i` where `sourceNormalize(source[i..])` starts with
`sourceNormalize(part)`, then the shortest `j > i` where
`sourceNormalize(source[i..j]) === sourceNormalize(part)`. The system SHALL set `start = i` and
`end = j` and advance the cursor to `j`, rather than assuming `end = start + part.length`.

Deriving `end` is what makes the guarantee hold for a part whose decoded length differs from
its source span; anchoring `start` alone leaves the cursor past the next real position. This
scan SHALL run only on the Tier 3 fallback path, so Tiers 1–2 remain byte-identical to the
default behavior, and the length-based advance SHALL remain in force whenever `sourceNormalize`
is absent.

The scan SHALL be bounded: the system SHALL search no more than a small multiple of the part's
normalized length before treating the part as unlocatable, so that anchoring cost stays linear
in input length (see "Anchoring cost is linear in input length").

#### Scenario: Equal-length content mutation

- **WHEN** a part has the same length as its source span but different bytes (e.g. `"hi"` for source `"Hi"`) and `sourceNormalize` lowercases
- **THEN** the part anchors at the source position of `"Hi"`, not at a later stray `h`

#### Scenario: WordPiece continuation prefix

- **WHEN** a part is a `##`-prefixed continuation (e.g. `"##ん"`) and `sourceNormalize` strips `##`
- **THEN** the part anchors on the source `"ん"`, and `end` is the end of that `"ん"` rather than three code units past its start

#### Scenario: Cursor advance follows the derived span

- **WHEN** a part's decoded length exceeds its source span and the next part is anchored after it
- **THEN** the cursor sits at the end of the derived span, so the next part anchors at its own true position

### Requirement: Unlocatable parts fail loudly

A part is unlocatable when its normalized form does not occur in the source within the bounded
window from the cursor. Control tokens (`[CLS]`, `[SEP]`, `[UNK]`) and genuinely mutating
splitters both land here, and the system SHALL NOT attempt to tell them apart: nothing in a
part distinguishes a tokenizer control token from ordinary source text of the same shape —
`[CLS]` is itself anchorable on its literal `[`, and today anchors silently against any source
containing one.

The system SHALL therefore throw for an unlocatable part, with a message naming the part and
the likely cause, rather than skipping it or anchoring it on a partial match. Splitters MUST
drop tokenizer control tokens before returning parts.

#### Scenario: Control token framing the input

- **WHEN** a splitter emits `[CLS]` / `[SEP]` around the real tokens and `sourceNormalize` is supplied
- **THEN** `split` throws identifying the unlocatable part, instead of anchoring it on an unrelated `[` and corrupting the positions of neighboring parts

#### Scenario: Splitter that drops control tokens

- **WHEN** the splitter filters `[CLS]` / `[SEP]` / `[UNK]` before returning parts
- **THEN** the remaining parts anchor at their true positions with full coverage
