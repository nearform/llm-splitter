## MODIFIED Requirements

### Requirement: Custom splitter contract

The system SHALL accept a custom `splitter` function that maps a string to an array of
parts. Each part MAY be a bare string, or an object `{ text, start }` reporting the part's
offset in the input — see the `splitter-positions` capability. A splitter MAY drop source bytes
between parts (e.g. whitespace) but MUST NOT mutate token content. Mutating splitters are
unsupported and MAY fail either loudly or silently — see the `multibyte-anchoring` capability
for the exact outcomes.

#### Scenario: Byte-dropping splitter

- **WHEN** a whitespace splitter such as `(t) => t.split(/\s+/)` is supplied
- **THEN** chunks are formed from the non-whitespace parts and positions still anchor to the source

#### Scenario: Mutating splitter is unsupported

- **WHEN** a splitter transforms token content (e.g. lowercasing or accent-stripping)
- **THEN** `split` throws if the part cannot be located at all, but MAY instead anchor at a wrong position if the mutated part matches elsewhere in the source

#### Scenario: Splitter reporting positions

- **WHEN** a splitter returns `{ text, start }` elements
- **THEN** the reported offsets are used directly and the anchoring search is not consulted for those parts
