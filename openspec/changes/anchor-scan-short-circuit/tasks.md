## 1. Evidence (complete)

- [x] 1.1 Instrument `anchorParts` tier resolution across latin / latin+emoji / cjk /
      devanagari x char / whitespace / sentence / tiktoken at 100KB; confirm every Tier 2
      miss contains U+FFFD (137,532 / 137,532) — recorded in design.md, Decision 1
- [x] 1.2 Record how far Tier 2 legitimately reaches (max 4 code units) so a future distance
      bound starts from measurement rather than a guess — design.md, Decision 1, alternatives
- [x] 1.3 Prototype both decisions and confirm bit-identical output over 594 scenarios,
      linear growth to 400KB, and no regression on non-U+FFFD splitters — design.md,
      Acceptance criteria

## 2. Anchoring changes

- [ ] 2.1 In `anchorParts` ([src/split.js](../../../src/split.js)), probe the source once per
      call for U+FFFD
- [ ] 2.2 Skip Tier 2 when the part contains U+FFFD and the source does not, falling through
      to Tier 3; keep Tier 2 unconditional when the source does contain U+FFFD
- [ ] 2.3 Return `null` early from `firstAnchorGrapheme` when the part has no
      non-replacement code unit, before segmenting
- [ ] 2.4 Update the `anchorParts` docstring so the three-tier description states the skip
      and its precondition, matching the `multibyte-anchoring` delta

## 3. Tests

- [ ] 3.1 Add a scaling regression to [test/split.test.js](../../../test/split.test.js) per
      design.md, Decision 4: a synthetic splitter (not `tiktoken` — the suite has no
      tokenizer dependency and should not gain one) emitting U+FFFD for every fourth part,
      over a U+FFFD-free source, `character` strategy, at **n = 40,000 and 2n = 80,000 code
      units**, best-of-3 per size taking the **minimum**, asserting `time(2n) / time(n) < 3`
- [ ] 3.2 Check the regression's own cost and floor: the whole test stays under **~150ms**
      on a correct implementation, and the min-of-3 at n stays above **~1ms** so the ratio
      measures growth rather than timer granularity. If either bound is missed, adjust n —
      not the threshold — and record the sizes actually used back into design.md, Decision 4
- [ ] 3.3 Add a case pinning the equivalence: a source that itself contains U+FFFD produces
      the same chunks as the same source without the skip being applicable
- [ ] 3.4 Add a case for an all-U+FFFD part alongside a U+FFFD-plus-combining-mark part, so
      the `firstAnchorGrapheme` fast path cannot swallow the second
- [ ] 3.5 Confirm `npm run check` is green (160 tests before this change's additions)

## 4. Verification

- [ ] 4.1 Run `node test/benchmark.js --diff` against the sibling published checkout and
      confirm every aggregate matches design.md, Acceptance criteria 1 (96 real / 87
      chunk-count / 9 anchor-drift / 0 uncovered / 0 contract violations / latin real=5)
- [ ] 4.2 Re-measure the growth table in design.md, Acceptance criteria 2 and confirm growth
      per doubling stays near 2x through 400KB
- [ ] 4.3 Re-measure Acceptance criteria 4 and confirm the absolute delta on non-U+FFFD
      splitters stays under 0.5ms per 100KB

## 5. Docs

- [ ] 5.1 Refresh [REWRITE.md](../../../REWRITE.md) — "The Devanagari case". Its narrative
      already describes this fix and delegates the rejected alternatives to design.md, so the
      work is: confirm the before/after and growth tables against the landed code (they came
      from the prototype), update the splitter median-ratio table, and flip the
      "**Status: proposed, not landed**" line
- [ ] 5.2 Update the `anchorParts` bullet in [AGENTS.md](../../../AGENTS.md) — Algorithm map
      to describe the Tier 2 skip, and note the scaling regression alongside the existing
      warning that the quadratic has moved once already
- [ ] 5.3 Add the literal-U+FFFD-in-source failure (identical before and after this change)
      to [tokenizer-length-inflation/research.md](../tokenizer-length-inflation/research.md)
      as another instance of the length-based-advance root cause

## 6. Follow-up (out of scope for this change)

- [ ] 6.1 If a caller reports a splitter that legitimately drops long spans, revisit the
      Tier 2 distance bound using the reach data in design.md rather than a fresh guess
