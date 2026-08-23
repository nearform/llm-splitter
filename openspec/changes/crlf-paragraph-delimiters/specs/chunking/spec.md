## MODIFIED Requirements

### Requirement: Paragraph strategy boundaries

In `"paragraph"` strategy the system SHALL treat the paragraph delimiters `"\n\n"` and
`"\r\n\r\n"` and array element boundaries as paragraph breaks, and SHALL trim leading and
trailing whitespace of a paragraph before anchoring so that chunk starts land on real content.
A lone `"\r\n"` or `"\n"` SHALL NOT break a paragraph — paragraphs remain blank-line-separated.

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

#### Scenario: CRLF blank lines separate paragraphs

- **WHEN** `split("first\r\n\r\nsecond", { chunkStrategy: "paragraph", splitter: (t) => t.split(/\s+/) })` is called with a `chunkSize` that fits only one paragraph per chunk
- **THEN** `"first"` and `"second"` anchor as separate paragraphs at their true offsets, and the delimiter code units are absorbed into the preceding chunk

#### Scenario: Lone CRLF does not separate paragraphs

- **WHEN** `split("first line\r\nsecond line", { chunkStrategy: "paragraph" })` is called with room for both lines
- **THEN** the input is treated as one paragraph and stays in a single chunk
