## ADDED Requirements

### Requirement: Source normalization option

The system SHALL accept an optional `sourceNormalize` function on `split(input, options)`,
defaulting to identity. When supplied, it declares the normalization the caller's tokenizer
applies (e.g. lowercase, NFD, strip-accents, `##`-strip) so that mutated parts can be
anchored against normalized source. The default identity value SHALL preserve today's exact
behavior for all existing splitters.

#### Scenario: Default identity normalization

- **WHEN** `split(input)` is called with no `sourceNormalize` option
- **THEN** anchoring behaves exactly as before, byte-for-byte, for char/whitespace/sentence/tiktoken splitters

#### Scenario: Caller-supplied normalization for gte-small

- **WHEN** `split(input, { splitter, sourceNormalize: (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") })` is called with a normalizing tokenizer
- **THEN** parts mutated by lowercasing and accent-stripping anchor to their correct source positions
