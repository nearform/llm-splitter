---
"llm-splitter": minor
---

Fix `split()` throwing or mis-anchoring when the source itself contains a literal U+FFFD replacement character — ordinary input for scraped or mojibake-recovered text.

- A tokenizer that fragments a multi-byte character emits parts made of U+FFFD. Those parts are manufactured, so they exist nowhere in the source, but a literal U+FFFD in the source used to make the verbatim search find one anyway — at the wrong offset. The cursor then advanced past real content and the next part threw `"Splitter returned a part that could not be located in input"`. `"漢 hello world � tail"` with a `tiktoken` splitter reproduced it in one line; the same text with the U+FFFD swapped for any other character worked fine. The verbatim search is now skipped for every part containing U+FFFD, whether or not the source has one.
- Fixed a related off-by-`k` in the same anchoring path: when a part's first anchorable grapheme sat `k` code units into the part, its position was used as the part's own, shifting the reported span right by `k` and advancing the cursor `k` too far. Parts like `"�cd"` now report the span they actually consumed.
- Chunking a source that contains U+FFFD is no longer quadratic. Every U+FFFD-bearing part previously paid a scan to end-of-input, which made large multi-byte documents unusable rather than merely slow; cost for an 8x larger input dropped from ~40x to ~7x.

Positions and chunk counts change for affected inputs, so persisted embeddings, citation offsets, and anything keyed on chunk index need regenerating.

One narrow behavior remains, now documented rather than implicit: the cursor-position check tests only whether the source begins with the part, and there a manufactured bare U+FFFD is byte-identical to a literal one. A literal U+FFFD sitting exactly at the cursor may therefore be claimed by a manufactured part, adding a chunk boundary at that position. Both are one code unit wide, so the cursor still advances correctly — nothing after it shifts, and chunk coverage is unaffected.
