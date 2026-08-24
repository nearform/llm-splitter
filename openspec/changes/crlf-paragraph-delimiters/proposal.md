## Why

Paragraph mode recognizes exactly one delimiter: `"\n\n"`. Windows-authored text separates
paragraphs with `"\r\n\r\n"`, so an entire CRLF document degrades to a single paragraph —
`chunkSize` still bounds the chunks, but the paragraph-preference behavior (emit early, keep
context together) never engages, which is the reason callers pick this strategy. This is
common in real corpora: email exports, Notion/Word copies, much of the web.

## What Changes

- Recognize `"\r\n\r\n"` alongside `"\n\n"` as a paragraph break in
  `chunkStrategy: "paragraph"`.
- Bare `"\r\n"` stays a line break, not a paragraph break — mirroring the existing
  blank-line (`"\n\n"`) contract, so paragraph = blank-line-separated remains true.
- No change to `"character"` strategy, anchoring, or the coverage contract: delimiters stay
  absorbed into the preceding chunk by forward extension, and paragraph trimming already
  strips stray `\r`.
- Deliberately out of scope: `"\r\r"` (classic Mac OS), mixed sequences like `"\n\r\n"`, and
  any configurable delimiter option.

## Capabilities

- **chunking** — modifies the "Paragraph strategy boundaries" requirement.
