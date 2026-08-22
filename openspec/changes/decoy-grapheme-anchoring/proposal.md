## Why

A part that mixes U+FFFD with real text and **does** occur verbatim in the source can anchor
on an earlier occurrence of its first anchorable grapheme, reporting a position a few code
units before the part's true offset. `literal-replacement-char-anchoring` introduced this when
it stopped consulting Tier 2 for U+FFFD-bearing parts, and accepted it as a stated limitation
on the grounds that no documented splitter could reach it. That reachability claim was wrong:
sentence and paragraph splitters (`text.split(/[.!?]+/)`, `text.split("\n\n")`) drop a
multi-character span between parts, which is exactly the condition, and the first is the
README's own worked example.

Measured over 16,842 randomized cases in that class whose source holds a literal U+FFFD:
**1,663 parts anchored away from their true offset, against 489 before Tier 2 was skipped.**

It is filed rather than fixed because the impact is much smaller than that number suggests,
and the available fix is incomplete. Nothing is dropped — coverage and the
`chunk.text === getChunk(input, start, end)` correspondence both hold — the boundary simply
lands early, and in 89% of affected cases the only code units that change chunk are the
separator the splitter discarded. `chunkOverlap: 2` removes the observable effect entirely
(28 → 0 tokens left whole in no chunk, at `chunkSize: 8`). So this is a chunking-quality
defect with a documented workaround, not a data-integrity one, and it does not justify
changing the anchoring strategy on its own schedule.

## What Changes

- **Verify a Tier 3 candidate before accepting it.** After the anchor-grapheme search finds a
  candidate, check that the part's non-U+FFFD code units line up with the source at that
  offset; if they do not, continue the search. Prototyped and measured: fixes the paragraph
  and both decoy cases, cuts the class from 1,663 wrong to 678, and leaves every gate that
  `literal-replacement-char-anchoring` established unchanged, including linearity.
- **Decide whether 678 is acceptable, or whether the remainder needs backtracking.** The
  residual is not closed by this approach; 678 is still worse than the 489 the pre-skip
  behavior produced. `design.md` records what the remaining cases look like and why they need
  a different mechanism.
- **Correct the record on what a local rule can do.** `literal-replacement-char-anchoring`'s
  `design.md` → Decision 4 concluded that no local rule could help. That holds only for rules
  choosing _between_ Tier 2's answer and Tier 3's; a skeleton check on a Tier 3 candidate is
  not vacuous, because Tier 3 has matched one grapheme rather than the whole part. Already
  corrected in that change's archived `design.md` and in AGENTS.md; restated here because it
  is the premise this change rests on.
- Not in scope: the Tier 1 residual (a literal U+FFFD at the cursor claiming a manufactured
  bare part), which no candidate-verification scheme reaches because Tier 1 fires first.
  Normalizing tokenizers stay with `tokenizer-length-inflation`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multibyte-anchoring`: the "A mixed part that is genuinely verbatim may anchor on an earlier
  decoy" exception narrows to the cases candidate verification cannot resolve, and
  "Three-tier locate strategy" gains the verification step.

## Impact

- **Code**: `anchorParts` in [src/split.js](../../../src/split.js) — the Tier 3 locate step
  only. No public API change, no change to the coverage invariant, no new option.
- **Specs**: [openspec/specs/multibyte-anchoring/spec.md](../../specs/multibyte-anchoring/spec.md).
- **Docs**: README's "Multibyte / Unicode Strings" section, which currently documents the
  exception and the `chunkOverlap` workaround; AGENTS.md's algorithm map and its
  "Backtracking anchor walk" entry.
- **Risk to existing behavior**: positions change for affected inputs, so this needs a
  changeset with the same "regenerate persisted embeddings / citation offsets" note. The
  prototype moved no position that the current implementation gets right.
- **Adjacent changes**: `tokenizer-length-inflation` replaces Tier 3 when `sourceNormalize` is
  set; this change edits the identity-path Tier 3, so whichever lands second rebases.
- **Dependencies**: none added.
