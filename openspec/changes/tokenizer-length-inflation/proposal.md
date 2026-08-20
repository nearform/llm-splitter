## Why

`split()` anchors each splitter part to the source by advancing a cursor
`cursor_after = cursor_before + splitPart.length`. This assumes a part's decoded length
equals the source span it consumed. Normalizing embedding-model tokenizers — `gte-small`,
`bge-small`, uncased BERT-style WordPiece, typically served via `@huggingface/transformers`
— break that assumption at decode time (NFD + lowercase + strip-accents, `##` continuation
prefixes, zero-span `[CLS]`/`[SEP]` control tokens). These tokenizers are exactly what RAG
authors — the library's primary audience — reach for, yet today they either throw
`"Splitter returned a part that could not be located in input"` or, worse, silently
mis-anchor `start`/`end`.

Phase 1 (real `gte-small` regression fixtures) is complete and
narrowed the problem: length inflation is only one of three failure modes, and the most
common one for `gte-small` is **equal-length content mutation** (`"Hi"` → `"hi"`), which a
pure inflation detector cannot locate. The evidence behind that finding lives in
[research.md](./research.md) (codename B7); this change tracks turning it into an
implementation.

## What Changes

- Add an opt-in `sourceNormalize` function to `split(input, options)` (default identity), so
  callers wiring up a normalizing tokenizer can declare the same normalization the tokenizer
  applies (e.g. `(s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")`).
- Replace the Tier 3 anchor step so that, when `sourceNormalize` is supplied, anchoring walks
  the source applying that normalization and matches `normalize(source[i..])` against
  `normalize(splitPart)` — correctly locating case/accent-mutated and `##`-prefixed parts
  instead of trusting the part's literal graphemes.
- Detect zero-source-span control tokens (parts with no source-anchorable graphemes, e.g.
  `[CLS]`) before anchoring and skip them rather than propagating a bogus cursor.
- Preserve today's exact behavior for length-preserving splitters (char, whitespace,
  sentence/line, tiktoken) — no regression, verified against the existing multibyte and
  Devanagari fixtures.
- Promote both suites parked in `design.md` → "Acceptance criteria" — the synthetic drift
  regression and the gte-small fixtures — from "documents the bug" to "asserts the fix".

## Capabilities

### Modified Capabilities

- `multibyte-anchoring`: the supported-tokenizer boundary moves normalizing tokenizers from
  "known limitation" toward supported; Tier 3 gains a normalized-comparison anchor and
  zero-source-span token handling.
- `chunking`: `split` gains the opt-in `sourceNormalize` option.

## Impact

- Source: [src/split.js](../../../src/split.js) — `anchorParts` (Tier 3 + pre-anchor
  filtering), `splitValidate` (accept/validate `sourceNormalize`), `SplitOptions` typedef.
- Tests: [test/split.test.js](../../../test/split.test.js) — wire the drift case and the
  gte-small fixtures from `design.md` into asserting tests; must keep tiktoken/Devanagari
  green.
- Docs: README "Supported tokenizers" section updated once implemented.
- Performance: normalized comparison only runs on the Tier 3 fallback path; the char/tiktoken
  happy paths (Tiers 1–2) are untouched.
- API: additive and backward compatible — `sourceNormalize` defaults to identity.
