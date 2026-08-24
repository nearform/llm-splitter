## Why

`anchorParts` runs Tier 2 (`input.indexOf(splitPart, cursor)`) for every part that fails the
`startsWith` fast path. When the part is not present verbatim in the source — the U+FFFD
fragments a BPE tokenizer emits when a token straddles a multi-byte sequence — that call
scans the entire remaining input before returning `-1`. With O(n) such parts, `split()`
becomes O(n²) in `character` strategy.

The cost is not theoretical. On a 100KB Devanagari document with a `tiktoken` splitter,
`split()` takes **1976ms**; at 400KB it takes **30.2 seconds**, growing 3.9x per doubling.
[core-rewrite/design.md](../2026-08-20-core-rewrite/design.md) — "Performance" records this as the one severe
outstanding regression against the published library (25.6x slower on that row), carries the
instrumentation and the prototype measurements below, and marks the fix "proposed, not
landed". What is missing is the code.

Instrumenting the tier decision across 4 corpora x 4 splitters at 100KB settles which one
is right: **every Tier 2 miss — 137,532 of them — contains U+FFFD, and none of them do not.**
That makes the fix a proof rather than a heuristic. If the source contains no U+FFFD, a part
that does contain one cannot be a substring of it, so Tier 2 is guaranteed to fail and can be
skipped outright. U+FFFD is the only character a supported splitter can manufacture, which is
precisely the boundary `multibyte-anchoring` already draws.

## What Changes

- Skip Tier 2 when the part contains U+FFFD and the source does not, falling straight through
  to Tier 3. Output is provably unchanged: the skipped call could only have returned `-1`.
- Return `null` immediately from `firstAnchorGrapheme` when the part is nothing but U+FFFD,
  instead of running an `Intl.Segmenter` pass to reach the same conclusion. ~50K of
  Devanagari's parts and ~70K of CJK's take this path at 100KB.
- Pin the resulting complexity with a scaling regression test, so the quadratic cannot
  return unnoticed — it has already moved once, from `findGrapheme` to the Tier 2 failure
  branch.
- Re-measure the rewrite record's Devanagari numbers against the landed implementation. Its narrative
  already describes this fix and delegates the rejected alternatives to `design.md`, so the
  work there is confirming the figures, not rewriting the section.

Not in scope: bounding the Tier 2 search window, classifying the splitter up front, or
carrying a resync hint. See `design.md` — Decision 1, alternatives, which is where the rewrite record
now points for all three: the U+FFFD test subsumes them at zero heuristic cost, and the
measured evidence argues against a distance bound.

No public API change. No observable output change.

## Capabilities

### Modified Capabilities

- `multibyte-anchoring`: the three-tier locate strategy gains an explicit statement that
  Tier 2 is skipped when it provably cannot succeed, and a new requirement that anchoring
  cost is linear in input length — scoped to a supported splitter over a source containing
  no U+FFFD, which is exactly the precondition the skip needs, and stating the two cases
  that stay unbounded.

## Impact

- Source: [src/split.js](../../../../src/split.js) — `anchorParts` (Tier 2 guard) and
  `firstAnchorGrapheme` (all-replacement fast path). ~9 lines added, 1 changed.
- Tests: [test/split.test.js](../../../../test/split.test.js) — a scaling regression asserting
  sub-quadratic growth on a U+FFFD-heavy synthetic splitter, plus equivalence cases.
- Docs: [core-rewrite/design.md](../2026-08-20-core-rewrite/design.md) — "Performance" (measurement refresh and status
  flip); [AGENTS.md](../../../../AGENTS.md) algorithm map.
- Performance: 19x on the pathological row, 3.4x on CJK, and the growth curve goes from
  quadratic to linear. Cost on splitters that never emit U+FFFD is ≤0.3ms per 100KB
  (`whitespace` worst case) and unmeasurable elsewhere.
- Relationship to `tokenizer-length-inflation`: independent. That change reworks Tier 3 for
  mutating tokenizers; this one only removes work from the Tier 2 failure path. Both touch
  `anchorParts`, so whichever lands second rebases on the other.
