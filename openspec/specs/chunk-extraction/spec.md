## Purpose

The chunk-extraction capability is the `getChunk(input, start, end)` function. Given the
same input passed to `split` and a `[start, end)` position range, it re-extracts the chunk
text. It is used internally by `split` and exposed so callers who persist only positions
(e.g. alongside embeddings) can later recover the source text without storing it.

## Requirements

### Requirement: String input extraction

The system SHALL, for string input, return the substring of the source over `[start, end)`.

#### Scenario: Substring of a string

- **WHEN** `getChunk(str, start, end)` is called with a string source and `0 <= start <= end`
- **THEN** it returns the source text over `[start, end)`

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

The system SHALL throw a `TypeError` when any input element is not a string, whether or not
that element overlaps `[start, end)`, because element types are checked before overlap is
considered. A non-array, non-string `input` (e.g. `null`) is treated as a single element and
therefore also throws.

#### Scenario: Non-string array element outside the range

- **WHEN** `getChunk(["hello", 123, "world"], 0, 5)` is called and the range covers only the first element
- **THEN** it throws a `TypeError` for the non-string element anyway

#### Scenario: Non-string input

- **WHEN** `getChunk(null, 0, 5)` is called
- **THEN** it throws a `TypeError`

### Requirement: Positions are clamped, not validated

The system SHALL clamp the requested range to what the input actually holds rather than
throwing on out-of-range positions: a range that overlaps no element yields an empty result
(`""` for string input, `[]` for array input), and a negative `start` or `end` is treated as
`0`. Consequently a negative `end` yields an empty result — the function does **not** follow
`String.prototype.slice` semantics, where a negative `end` counts back from the end of the
string.

#### Scenario: Range beyond the input

- **WHEN** `getChunk("hello", 10, 15)` is called
- **THEN** it returns `""` without throwing

#### Scenario: Empty range for array input

- **WHEN** `getChunk(arr, start, end)` overlaps no element (e.g. an empty range, or a range past the total length)
- **THEN** it returns `[]`

#### Scenario: Negative end is not slice semantics

- **WHEN** `getChunk("hello", 0, -2)` is called
- **THEN** it returns `""`, not `"hel"`
