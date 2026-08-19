## Purpose

The chunk-extraction capability is the `getChunk(input, start, end)` function. Given the
same input passed to `split` and a `[start, end)` position range, it re-extracts the chunk
text. It is used internally by `split` and exposed so callers who persist only positions
(e.g. alongside embeddings) can later recover the source text without storing it.

## Requirements

### Requirement: String input extraction

The system SHALL, for string input, return the substring of the source over `[start, end)`.

#### Scenario: Substring of a string

- **WHEN** `getChunk(str, start, end)` is called with a string source
- **THEN** it returns `str.slice(start, end)`

### Requirement: Array input extraction

The system SHALL, for array-of-strings input, walk elements tracking a running offset and
return an array of the overlapping element substrings, where the first and last elements MAY
be partial.

#### Scenario: Range spanning multiple elements

- **WHEN** `getChunk(arr, start, end)` covers positions that span more than one array element
- **THEN** it returns an array whose first and last entries are the partial overlaps and whose middle entries are whole elements

### Requirement: Round-trip with split

The system SHALL extract exactly the text of a chunk produced by `split`: for any chunk,
`getChunk(input, chunk.start, chunk.end)` equals `chunk.text`.

#### Scenario: Chunk text round-trips

- **WHEN** `split` returns a chunk and `getChunk` is called with that chunk's `start` and `end`
- **THEN** the result equals the chunk's `text`

### Requirement: Non-string elements rejected

The system SHALL throw a `TypeError` when an input array element is not a string.

#### Scenario: Non-string array element

- **WHEN** `getChunk` encounters a non-string element within the overlapping range
- **THEN** it throws a `TypeError`
