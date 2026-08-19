## Context

`anchorParts` in [src/split.js](../../../src/split.js) uses a three-tier locate per part:
`startsWith(part, cursor)` → `indexOf(part, cursor)` → `indexOf(firstAnchorGrapheme(part), cursor)`,
with the cursor advanced by `part.length`. Tiers 1–2 are the perf-critical happy paths for
byte-preserving splitters; Tier 3 is the safety net for byte-mutating ones (tiktoken emits
one U+FFFD per undecodable byte, so length still equals source span).

Phase 1 wired `@huggingface/transformers` v4 + `Xenova/gte-small` into the suite as
regression fixtures (gated by `B7_TEST=1`) and produced concrete evidence (full writeup in
[docs/tokenizer-length-inflation.md](../../../docs/tokenizer-length-inflation.md), "Phase 1
findings"). Key facts that constrain the design:

- For `"Hi there. I'm Evän."`, `gte-small` decodes to
  `["[CLS]","hi","there",".","i","'","m","evan",".","[SEP]"]`.
- Three distinct failure modes exist: (1) length inflation (`"##ん"` len 3 vs span 1; `[CLS]`
  len 5 vs span 0), (2) **equal-length content mutation** (`"Hi"`→`"hi"`, `"Evän"`→`"evan"`) —
  the most common gte-small case, (3) zero-span control tokens (`[CLS]`/`[SEP]`/`[UNK]`).
- Tier 3 `firstAnchorGrapheme` _actively harms_ normalizing splitters: it anchors `##ん` on
  the literal `#` (absent from source) and silently mis-anchors `"hi"` into the `h` of
  `"there"`. Silent mis-anchoring is usually masked by a later cascading throw, but not always.
- `chunk.text` is resliced from source via `start`/`end`, so the risk surface is entirely the
  anchor _positions_, not the text payload.

## Goals / Non-Goals

**Goals:**

- Correctly position parts from normalizing tokenizers when the caller declares the
  normalization via an opt-in `sourceNormalize`.
- Zero behavior change and zero perf regression for length-preserving splitters (char,
  whitespace, sentence/line, tiktoken).
- Turn the synthetic drift regression (now in "Acceptance criteria") and the `B7_TEST=1`
  `gte-small` fixtures into asserting tests.

**Non-Goals:**

- Auto-detecting the tokenizer's normalization pipeline (rejected — see Decisions).
- Inverting arbitrary lossy normalization; if the caller's `sourceNormalize` cannot map a
  part to a source window, throwing loudly remains correct.
- Broadening fixtures to other models (`bge-small`, `all-MiniLM-L6-v2`,
  `multilingual-e5-small`) — tracked as follow-up once the core fix lands.

## Decisions

**Prior attempt (reverted): hybrid cursor.** Keep length-based `end`, compute the cursor
from an anchor walk through the part's graphemes. It broke tiktoken on `"Hindi: नमस्ते दुनिया"`:
tiktoken emits `" �"` (source span 2), the anchor walk found only the space and advanced by
1, under-advancing the cursor so the next precomposed grapheme mis-anchored. Conclusion: the
fix must _detect_ the splitter's mode, not impose one universal cursor.

**Directions considered** (from the B7 doc, cheapest first): A. per-part inflation detection
(compare code points until divergence, U+FFFD as wildcard) — necessary but insufficient: it
locates inflation and zero-span tokens but _not_ equal-length mutation. B. `splitterKind`
enum — explicit but adds API surface and pushes classification onto users. C. two-pass
fallback on throw — misses silent mis-anchoring, doubles work, retries genuine bugs. D.
per-call classifier — awkward in the streaming loop, strictly worse than A. E. punt/document —
the current posture.

**Chosen: A + opt-in normalized Tier 3 + zero-span filtering.**

1. **`sourceNormalize` option** (default identity). Cheaper than the `splitterKind` enum
   (B) and needs no classification heuristics (D). Callers declare intent explicitly:
   `sourceNormalize: (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")`.
2. **Normalized-comparison Tier 3.** When `sourceNormalize` is set, replace
   `indexOf(firstAnchorGrapheme(part), cursor)` with: walk source from `cursor`, find the
   first `i` where `normalize(source[i..])` starts with `normalize(part)`; set `start = i`.
   This is the only approach that handles equal-length content mutation.
3. **Pre-anchor zero-source-span detection.** Parts with no source-anchorable graphemes
   (`[CLS]` etc.) emit no position / are skipped rather than propagating the cursor.
4. **Coverage invariant preserved.** `end` still derives so adjacent chunks meet; the
   `chunk-coverage` contract is unchanged.

## Risks / Trade-offs

- **Correctness vs tiktoken.** The normalized path must not perturb tiktoken/Devanagari.
  Mitigation: normalized Tier 3 only engages when `sourceNormalize` is non-identity; default
  path is byte-identical to today. Re-run the multibyte + `B7_TEST=1` fixtures and the
  Devanagari case explicitly.
- **Cost.** Normalized comparison is O(window) and allocates per Tier 3 fallback. Mitigation:
  Tiers 1–2 (99.6% of parts on real corpora) are untouched; bound the forward search window.
- **Lossy normalization ambiguity.** If `normalize(part)` matches multiple source windows,
  first-match-from-cursor is the rule (same as `indexOf` today); document it.
- **User burden.** Callers must supply a `sourceNormalize` matching their tokenizer. Accepted:
  explicit and debuggable beats a hidden auto-classifier that silently guesses wrong.
- **Synthetic vs real divergence.** A synthetic drift test once passed while tiktoken broke;
  gate the change on the real `B7_TEST=1` fixtures, not just the synthetic case below.

## Acceptance criteria

This section holds the synthetic cursor-drift regression that used to live as an `it.todo` in
`test/split.test.js`. It was extracted here (Aug 2026) so `npm test` stays clean — its body
throws today, which node echoes under a "failing tests" banner even for todo tests. Task 4.1
re-adds it as a real asserting test when B7 is implemented.

**Synthetic drift splitter.** A splitter that appends a U+FFFD byte to every character, so
each part's decoded length (2) exceeds its source span (1). Today this throws at the second
part: `end`/`cursor` advance by `part.length`, so after `"a�"` the cursor sits at 2, and
the anchor `b` (at source position 1) can't be found from cursor 2.

```js
const driftSplitter = (text) => text.split("").map((ch) => ch + "�");
// For "abc" the splitter yields ["a�", "b�", "c�"].
const result = split("abc", { chunkSize: 3, splitter: driftSplitter });
assert.deepStrictEqual(result, [{ text: "abc", start: 0, end: 3 }]);
```

Why it matters: tiktoken keeps 1:1 byte↔char (one U+FFFD per undecodable byte), so the
length-based cursor is exact for it; a fix must therefore _detect_ inflation rather than
switch cursor algorithms wholesale (the reverted hybrid-cursor attempt undershot tiktoken and
broke the Devanagari fixture). The fix must satisfy both this synthetic case **and** the real
`B7_TEST=1` `gte-small` fixtures, and must not regress tiktoken.
