## Why

`llm-splitter@0.2.0` silently discarded input. Two independent defects in `findMatches`
and the paragraph-group lookup caused splitter parts — and in the worst case entire
paragraphs — to be dropped without any error, while every chunk it returned still
satisfied `chunk.text === getChunk(input, chunk.start, chunk.end)`. The output was
internally consistent and externally wrong, which is the hardest failure mode to notice
downstream: a RAG index built on it is missing text that nothing reports as missing.

Measured head-to-head across 270 scenarios (3 corpora x 3 input sizes x 2 chunk
strategies x 3 chunk sizes x 2 overlaps x 3 splitters), **0.2.0 left 1,179,904 UTF-16
code units unattributable across 186 of the 270 scenarios.** This rewrite leaves 0 in 0.

This record exists because the rewrite predates the repo's adoption of OpenSpec, so there
was no change folder to archive at the time. The behavioral contract it establishes now
lives in `openspec/specs/chunk-coverage/` and `openspec/specs/multibyte-anchoring/`; what
is preserved here is the evidence for _why_ those requirements are worded the way they
are, and the proof that the pre-rewrite implementation violated them.

It also absorbs the findings that used to live in a root-level `REWRITE.md`, retired once
the rewrite shipped. Sibling changes that cite that file — notably
[2026-08-20-anchor-scan-short-circuit/](../2026-08-20-anchor-scan-short-circuit/) — now
point at `design.md` here instead; their prose still describes the state at the time they
were written.

## What Changed

Three differences against `0.2.0`, of which two are bug fixes and one is a deliberate
design change:

| ID  | Difference                                                           | Kind              | Scope                                   |
| --- | -------------------------------------------------------------------- | ----------------- | --------------------------------------- |
| A   | Chunk `end` extends forward to the next chunk's `start`              | **design change** | explains 100 of 196 differing scenarios |
| B   | `0.2.0` discards splitter parts containing no character `<= U+00FF`  | **bug in 0.2.0**  | most of the 96 real differences         |
| C   | `0.2.0` locates paragraph groups with `indexOf(paragraph, prev + 1)` | **bug in 0.2.0**  | all 13 `char`-splitter real differences |

Details, minimal reproductions and the regression mapping are in `design.md`.

Secondary to the algorithm, and not covered further here: the source moved from
TypeScript to plain JavaScript with JSDoc annotations, `tsc` runs declaration-only, and
tests run on the built-in `node --test` runner. See AGENTS.md — "Architecture in one
paragraph".

## Impact

- Affected specs: `chunk-coverage` (all requirements), `multibyte-anchoring` (three-tier
  locate, unanchorable parts, mutating splitters unsupported).
- Affected code: `src/split.js` (rewritten), `src/get-chunk.js`, `src/index.js`.
- **Breaking for consumers.** Positions and chunk counts change, so persisted embeddings,
  citation offsets and anything keyed on chunk index must be regenerated. Shipped as the
  `0.3.0` minor, which is the breaking-change slot pre-1.0 — see docs/CONTRIBUTING.md.
- **Mutating splitters now fail loudly.** A splitter that rewrites its parts (lowercasing,
  accent-stripping, NFC/NFD) previously produced mis-anchored chunks; it now throws when a
  part cannot be located. This is the same underlying failure, made visible. The remaining
  tolerance work is tracked in `openspec/changes/tokenizer-length-inflation/`.
