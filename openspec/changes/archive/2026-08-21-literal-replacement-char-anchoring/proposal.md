## Why

A source that contains a literal U+FFFD makes `split()` throw or mis-anchor under
`tiktoken` — the tokenizer this library documents as fully supported. Scraped and
mojibake-recovered text is where literal U+FFFD comes from, so this is ordinary
RAG-corpus input rather than an exotic edge case.

The failure was found and deliberately deferred during `anchor-scan-short-circuit`
(`design.md` → "Risks / Trade-offs" → "**[Source containing literal U+FFFD]**": "_Not
introduced here; the correctness half belongs to `tokenizer-length-inflation`_") and
recorded in `tokenizer-length-inflation/research.md` as "a fourth instance of the same
root cause". That parking is now worth revisiting on its own: unlike the normalizing-
tokenizer modes that change owns, this shape needs **no normalization support at all**.
It is reachable with a 1:1 tokenizer, it reproduces in one line, and a fix does not
depend on any of `tokenizer-length-inflation`'s design decisions. Splitting it out lets
it ship without waiting on the larger change, and keeps that change's scope on the
normalization problem it was written for.

Deferring it further has a cost the original deferral did not weigh: the shipped
`multibyte-anchoring` spec and README both affirmatively promise `tiktoken` is correctly
positioned, naming normalizing tokenizers as the only limitation. Whatever this change
concludes, that gap gets closed.

## What Changes

- **Pin the failure with a regression.** A `tiktoken` fixture over a source carrying a
  literal U+FFFD, plus a splitter-only synthetic that reproduces the same shape without
  the native dependency. Following the convention `tokenizer-length-inflation` set, the
  test code lives in this change's `design.md` → "Acceptance criteria" until the fix
  lands; `test/split.test.js` stays unconditional and green.
- **Skip tier 2 for every part containing U+FFFD.** Today `anchorParts` re-enables tier 2
  whenever the source contains U+FFFD, which lets a decode-produced U+FFFD match an
  unrelated literal one. Dropping that disjunct is the fix.
- **Correct the tier 3 anchor offset, which is what makes the above safe.** Tier 3 sets
  `start` to the position of the part's first anchorable grapheme, even when that grapheme
  sits `k` code units into the part — so the span is shifted right by `k` and the cursor
  overshoots by `k`. This is an independent latent defect, and it is the sole reason the
  simple tier 2 fix was rejected in an earlier round of this change's design: both unit
  failures attributed to that fix were this off-by-`k`. Measured in `design.md`.
- **Close the linearity carve-out too.** With tier 2 skipped for U+FFFD-bearing parts
  regardless of the source, the unbounded per-part search that
  `anchor-scan-short-circuit` carved out as a permanent limitation goes away. Measured at
  40.8x → 10.7x cost for an 8x input span. That is a spec deletion, not a widening.
- **State what remains in the contract.** Two residuals survive and both are stated: tier 1
  can still match a manufactured bare U+FFFD against a literal one standing at the cursor
  (benign — one extra chunk boundary, no drift), and a genuinely-verbatim mixed part can
  anchor on an earlier decoy grapheme under a content-dropping splitter. `design.md` →
  Decision 4 shows no rule reading only the part, source, and cursor can close either.
- Not in scope: normalizing/length-inflating tokenizers, and the `chunkSize`-undercount
  behavior. Both stay with `tokenizer-length-inflation`. Backtracking in the anchor walk is
  out of scope and recorded as a follow-up.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multibyte-anchoring`: "Three-tier locate strategy" gains the tier 3 left-edge rule and
  skips tier 2 for every U+FFFD-bearing part; "Anchoring cost is linear in input length"
  **drops** its carve-out for a source containing U+FFFD rather than widening it;
  "Supported tokenizer boundary" stops claiming `tiktoken` is unconditionally correctly
  positioned; and a new requirement pins what happens when a decode-produced U+FFFD part
  meets a literal U+FFFD in the source, including the two residual exceptions.

## Impact

- **Code**: `anchorParts` in [src/split.js](../../../../src/split.js) — the tier 2 guard at
  the `sourceHasReplacement ||` disjunct, plus `firstAnchorGrapheme` (returns
  `{ segment, offset }`) and the tier 3 locate that consumes it. No public API change; no
  change to the coverage invariant.
- **Specs**: [openspec/specs/multibyte-anchoring/spec.md](../../../specs/multibyte-anchoring/spec.md).
- **Docs**: README's "Supported tokenizers (and a known limitation)" section, whose
  `tiktoken` line ("✅ … so length matches source span") is the user-facing half of the
  same overclaim.
- **Adjacent changes**: rebases under `tokenizer-length-inflation` — both touch
  `anchorParts`, and that change's fix for length-vs-span mismatch must be checked
  against this shape too (already noted in its `research.md`). Whichever lands second
  reconciles.
- **Risk to existing behavior**: the benign case — a part whose U+FFFD genuinely is in
  the source — is currently anchored by tier 2 and is pinned by `test/split.test.js`
  ("locates a replacement char that is genuinely in the source"). The tier 3 offset
  correction keeps it passing without tier 2. One other pinned expectation is renegotiated
  deliberately: "drops unanchorable parts without dropping mixed ones" moves from
  `[["cd", 2, 4]]` to `[["bcd", 1, 4]]`, which is the correct left edge for a 3-code-unit
  part ending at 4.
- **Dependencies**: none added. `tiktoken` is already a devDependency.
