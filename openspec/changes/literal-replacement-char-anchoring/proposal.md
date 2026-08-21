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
- **Spike a fix for tier 2 under a U+FFFD-bearing source.** Today `anchorParts` re-enables
  tier 2 whenever the source contains U+FFFD, which lets a decode-produced U+FFFD match
  an unrelated literal one. Candidate approaches and the trade-off each carries are
  enumerated in `design.md`; the spike picks one on evidence.
- **State the correctness limitation in the contract, whether or not the fix lands.** The
  `multibyte-anchoring` carve-out for a U+FFFD-bearing source is currently scoped to
  linearity only ("_no linearity guarantee applies_"). It says nothing about anchoring
  correctness, while the archived design doc acknowledges that half exists. That is the
  minimum outcome of this change; a fix supersedes it.
- Not in scope: normalizing/length-inflating tokenizers, and the `chunkSize`-undercount
  behavior. Both stay with `tokenizer-length-inflation`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multibyte-anchoring`: the "Anchoring cost is linear in input length" carve-out for a
  source containing U+FFFD is widened to cover anchoring **correctness**, not only
  linearity; the "Supported tokenizer boundary" requirement stops claiming `tiktoken` is
  unconditionally correctly positioned; and a scenario pins the behavior when a
  decode-produced U+FFFD part meets a literal U+FFFD in the source.

## Impact

- **Code**: `anchorParts` in [src/split.js](../../../src/split.js) — the tier 2 guard at
  the `sourceHasReplacement ||` disjunct, and possibly `firstAnchorGrapheme`. No public
  API change; no change to the coverage invariant.
- **Specs**: [openspec/specs/multibyte-anchoring/spec.md](../../specs/multibyte-anchoring/spec.md).
- **Docs**: README's "Supported tokenizers (and a known limitation)" section, whose
  `tiktoken` line ("✅ … so length matches source span") is the user-facing half of the
  same overclaim.
- **Adjacent changes**: rebases under `tokenizer-length-inflation` — both touch
  `anchorParts`, and that change's fix for length-vs-span mismatch must be checked
  against this shape too (already noted in its `research.md`). Whichever lands second
  reconciles.
- **Risk to existing behavior**: the benign case — a part whose U+FFFD genuinely is in
  the source — is currently anchored by tier 2 and is pinned by `test/split.test.js`
  ("locates a replacement char that is genuinely in the source"). Any fix that disables
  tier 2 for U+FFFD-bearing parts must keep that scenario working or consciously
  renegotiate it.
- **Dependencies**: none added. `tiktoken` is already a devDependency.
