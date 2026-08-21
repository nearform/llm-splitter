---
"llm-splitter": minor
---

Rewrite the chunking core so chunk positions account for the whole input.

- Chunks now cover the source: each chunk's `end` extends to the next chunk's `start`, and the last chunk ends at the input length. Chunk text can therefore include whitespace and `\n\n` delimiters that previously fell between chunks.
- Fixed a bug where one splitter part containing no ASCII stranded the cursor and caused every part after it to be dropped. On text with no ASCII at all this discarded nearly the entire input.
- Fixed paragraph groups being located with `indexOf`, which mis-anchored a paragraph whose text also appears earlier in the document and could drop the final chunk.
- Splitters that rewrite their parts (lowercasing, accent-stripping, NFC/NFD — common in `@huggingface/transformers` embedding tokenizers such as `gte-small`) may now throw instead of returning mis-anchored chunks. Normalize the input the same way before calling `split()`, or chunk with a 1:1 tokenizer such as `tiktoken`.
- **Removed the `splitToParts` export.** It exposed an internal stage of the old algorithm, which the rewrite reshaped; there is no drop-in replacement. `split()` is the supported entry point, and each chunk's `start`/`end` locate it in the source.

Positions and chunk counts change, so persisted embeddings, citation offsets, and anything keyed on chunk index need regenerating.

**Types: `chunk.text` now follows your input.** `split(str)` returns `Chunk<string>[]` and `split(arr)` returns `Chunk<string[]>[]`, so TypeScript consumers no longer have to narrow `string | string[]` on every access; `getChunk` narrows the same way, and `Chunk` takes an optional type parameter that defaults to the union. Runtime behavior is unchanged. Passing a value typed `string | string[]` still compiles and still returns the union, so most code needs no edit — but code that relied on `chunk.text` being the union (for example an `Array.isArray` branch that is now unreachable, or an explicit `Chunk<string | string[]>` annotation assigned from a narrowed call) may need adjusting.

Also: source is now plain JavaScript with JSDoc annotations rather than TypeScript, with `.d.ts` files published for TypeScript consumers, and `SplitOptions` is exported as a type.
