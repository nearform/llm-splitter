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

#### Scenario: Length-preserving tokenizer

- **WHEN** a splitter's decoded part length equals its consumed source span (char, whitespace, sentence, tiktoken)
- **THEN** every part anchors to a correct source position, whether or not `sourceNormalize` is supplied

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

When `sourceNormalize` is supplied, the system SHALL replace the Tier 3 grapheme lookup with
a normalized forward scan: from the cursor, find the first source index `i` where
`sourceNormalize(source[i..])` starts with `sourceNormalize(part)`, and anchor `start` there.
This scan SHALL run only on the Tier 3 fallback path so Tiers 1–2 remain byte-identical to
the default behavior.

#### Scenario: Equal-length content mutation

- **WHEN** a part has the same length as its source span but different bytes (e.g. `"hi"` for source `"Hi"`) and `sourceNormalize` lowercases
- **THEN** the part anchors at the source position of `"Hi"`, not at a later stray `h`

#### Scenario: WordPiece continuation prefix

- **WHEN** a part is a `##`-prefixed continuation (e.g. `"##ん"`) and `sourceNormalize` strips `##`
- **THEN** the part anchors on the source `"ん"` rather than on the literal `#`

### Requirement: Zero-source-span token handling

The system SHALL detect parts that contain no source-anchorable graphemes (zero-span control
tokens such as `[CLS]`, `[SEP]`, `[UNK]`) before anchoring and SHALL skip them without
advancing the cursor onto unrelated source bytes.

#### Scenario: Control token framing the input

- **WHEN** a splitter emits `[CLS]` / `[SEP]` around the real tokens
- **THEN** those parts consume no source span and do not corrupt the positions of neighboring parts
