---
"llm-splitter": minor
---

Rewrite the chunking core so chunk positions account for the whole input.

- Chunks now cover the source: each chunk's `end` extends to the next chunk's `start`, and the last chunk ends at the input length. Chunk text can therefore include whitespace and `\n\n` delimiters that previously fell between chunks.
- Fixed a bug where one splitter part containing no ASCII stranded the cursor and caused every part after it to be dropped. On text with no ASCII at all this discarded nearly the entire input.
- Fixed paragraph groups being located with `indexOf`, which mis-anchored a paragraph whose text also appears earlier in the document and could drop the final chunk.
- Splitters that rewrite their parts (lowercasing, accent-stripping, NFC/NFD — common in `@huggingface/transformers` embedding tokenizers such as `gte-small`) may now throw instead of returning mis-anchored chunks. Normalize the input the same way before calling `split()`, or chunk with a 1:1 tokenizer such as `tiktoken`.

Positions and chunk counts change, so persisted embeddings, citation offsets, and anything keyed on chunk index need regenerating.

Also: source is now plain JavaScript with JSDoc annotations rather than TypeScript, with `.d.ts` files published for TypeScript consumers, and `SplitOptions` is exported as a type.
