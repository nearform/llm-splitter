## Purpose

The chunk-coverage capability defines the positional contract that `split()` guarantees: it
is lossless on positions from the first chunk's start onward, so downstream consumers (RAG
citations, source highlighting, re-chunking, "which chunk owns position N?" queries) can
rely on chunk `[start, end)` ranges to cover the source without gaps. This contract is the
reason chunks carry positions at all, and it MUST NOT be broken by algorithm changes.

## Requirements

### Requirement: Lossless position coverage

The system SHALL ensure that every UTF-16 code unit of the source at index `p`, where
`chunks[0].start <= p < input.length`, appears in at least one chunk's `[start, end)` range.

#### Scenario: Every interior position is covered

- **WHEN** `split(input, options)` returns a non-empty chunk list
- **THEN** for every position `p` from `chunks[0].start` up to `input.length - 1`, some chunk's range `[start, end)` contains `p`

### Requirement: Adjacent chunk continuity

The system SHALL emit chunks whose ranges meet or overlap: for every adjacent pair,
`chunks[i].end >= chunks[i+1].start`. Without overlap they are equal; with `chunkOverlap`
they overlap.

#### Scenario: No-overlap adjacency

- **WHEN** chunks are produced with `chunkOverlap: 0`
- **THEN** `chunks[i].end === chunks[i+1].start` for each adjacent pair

#### Scenario: Overlapping adjacency

- **WHEN** chunks are produced with `chunkOverlap > 0`
- **THEN** `chunks[i].end >= chunks[i+1].start` for each adjacent pair

### Requirement: Final chunk terminates at input length

The system SHALL set the last chunk's `end` to the total input length so no trailing code
units are dropped.

#### Scenario: Last chunk end

- **WHEN** `split(input, options)` returns chunks
- **THEN** `chunks[chunks.length - 1].end === input.length`

### Requirement: UTF-16 code-unit offsets

The system SHALL express `start` and `end` as JavaScript string indices (UTF-16 code-unit
offsets), so a single character may occupy one or two units (a typical emoji is two, a CJK
character is one).

#### Scenario: Offsets index the source string

- **WHEN** a chunk has `start` and `end`
- **THEN** `input.slice(start, end)` yields that chunk's source span

### Requirement: Dropped code units absorbed into previous chunk

When a splitter drops code units at a paragraph or token boundary, the system SHALL absorb
those positions into the previous chunk by extending its `end` forward to the next chunk's
`start`, rather than leaving them uncovered. Consequently a chunk's text may end with
trailing whitespace or `"\n\n"`.

#### Scenario: Boundary whitespace retained

- **WHEN** a splitter drops whitespace between the last part of one chunk and the first part of the next
- **THEN** those dropped positions are included at the end of the earlier chunk's `[start, end)` range

### Requirement: Leading code units may be uncovered

The system SHALL NOT extend any chunk backward before `chunks[0].start`; code units before
that position MAY therefore be left uncovered, because there is no previous chunk to extend
forward into them. This is the only place coverage is not full.

#### Scenario: Leading whitespace before first chunk

- **WHEN** the first paragraph begins with leading whitespace that the splitter drops
- **THEN** those leading positions appear in no chunk and `chunks[0].start` lands on the first anchored content
