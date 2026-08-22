---
"llm-splitter": minor
---

Rewrite the chunking core so chunk positions account for the whole input.

**Breaking — regenerate anything keyed on positions.** Chunk positions and counts change, so persisted embeddings, citation offsets, and chunk indices need rebuilding.

- Chunks now cover the source: each chunk's `end` extends to the next chunk's `start`, and the last chunk ends at the input length. Chunk text therefore includes whitespace and `\n\n` delimiters that previously fell between chunks.
- `chunk.text` now follows your input type — `split(str)` returns `Chunk<string>[]`, `split(arr)` returns `Chunk<string[]>[]`, so TypeScript consumers no longer narrow a union on every access. A `string | string[]` argument still compiles and still returns the union.
- Removed the `splitToParts` export. It exposed an internal stage of the old algorithm and has no drop-in replacement; `split()` is the supported entry point.
- Splitters that rewrite their parts (lowercasing, accent-stripping, NFC/NFD — common in `@huggingface/transformers` embedding tokenizers such as `gte-small`) may now throw instead of returning mis-anchored chunks. Normalize the input the same way before calling `split()`, or chunk with a 1:1 tokenizer such as `tiktoken`.

**Fixed**

- Text with no ASCII was mostly discarded. A part with no anchorable character left the cursor stranded, dropping every part after it — on CJK and other non-Latin scripts that lost most of the document.
- `split()` threw on sources containing a literal U+FFFD (`�`), common in scraped and mojibake-recovered text.
- Multibyte parts anchored a few code units to the right of their true position when the part's first anchorable character sat partway into it.
- Paragraph groups were located by substring search, which mis-anchored a paragraph whose text appeared earlier in the document and could drop the final chunk.

**New: a splitter can report each part's source position.** Return `{ text, start }` in place of a bare string and that offset is used verbatim rather than inferred by searching. The two forms mix freely in one array. `delimiterSplitter(delimiter)` builds a reporting splitter for the common case. This is the way around the inference limitations in the README's "Known limitations".

Also: source is now plain JavaScript with JSDoc annotations rather than TypeScript, with `.d.ts` published for TypeScript consumers, and `SplitOptions` and `SplitterPart` are exported as types.
