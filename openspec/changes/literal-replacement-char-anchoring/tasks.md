## 1. Pin the failures before changing anything

- [ ] 1.1 Add the real-tokenizer regression from [design.md](./design.md) → "Acceptance criteria" § 1 to `test/split.test.js`, and confirm it **fails** at head with `Splitter returned a part that could not be located in input`.
- [ ] 1.2 Add the splitter-only synthetic from "Acceptance criteria" § 2 and confirm it also fails at head. Two independent repros, so the regression survives the `tiktoken` devDependency being dropped.
- [ ] 1.3 Add the tier 3 offset regression from "Acceptance criteria" § 3. This one **passes** at head — head gets `"a �b"` right via tier 2's exact match. It exists to stop the `- anchor.offset` in task 2.1 being dropped as redundant once tier 2 no longer covers for it, so note that in the test comment.
- [ ] 1.4 Record the baseline control result in the test comment: `"漢 hello world X tail"` succeeds with `[{ text: " hello world X tail", start: 1, end: 20 }]`, which is what makes the U+FFFD the isolated cause rather than the multi-byte character.

## 2. Apply the fix — both halves, in this order

- [ ] 2.1 In `anchorParts` ([src/split.js](../../../src/split.js)), make `firstAnchorGrapheme` return `{ segment, offset }` (the offset is `Intl.Segmenter`'s `index`, already available) and change the tier 3 locate to `indexOf(anchor.segment, cursor + anchor.offset) - anchor.offset`. Update the JSDoc `@returns`; `check:types` passes with the object form.
- [ ] 2.2 Confirm 2.1 alone changes exactly one unit expectation — "drops unanchorable parts without dropping mixed ones" goes from `[["cd", 2, 4]]` to `[["bcd", 1, 4]]` — and update it per design.md → Decision 3, with a comment saying why 1 is the correct left edge. 166/167 at this point; the two § 1 regressions still fail.
- [ ] 2.3 Replace the tier 2 guard's `sourceHasReplacement || !splitPart.includes(REPLACEMENT_CHAR)` with the bare `!splitPart.includes(REPLACEMENT_CHAR)`, and delete the now-unused `sourceHasReplacement` probe.
- [ ] 2.4 Comment the tier 3 call site with _why_ the offset subtraction is load-bearing: it is what makes 2.3 safe. Design.md → Decision 2 records that dropping the disjunct **without** 2.1 fails "locates a replacement char that is genuinely in the source" (`[["a �",0,3],["b",3,4]]` instead of `[["a ",0,2],["�b",2,4]]`) and the contract fuzz. Without this comment the two edits look independent and either can be reverted alone — which is worse than reverting both.
- [ ] 2.5 Confirm both § 1 regressions now pass and `npm test` is 167/167 (166 unchanged + the updated expectation from 2.2, plus the 3 new tests).

## 3. Verify against the measurements, not just the suite

- [ ] 3.1 Re-run the differential fuzz from design.md → Method on a patched and an unpatched tree, same seed. Gate: **zero `OK→THROW` transitions** and **zero invariant violations** across all three sweeps (3,000 strings, 10,000 strings, 2,000 arrays).
- [ ] 3.2 Record the final throw counts in this file. The spike measured **0** throws in all three sweeps, against 743 / 2,487 / 472 at head. Any nonzero result means the patch drifted from what was measured and needs explaining before landing.
- [ ] 3.3 Re-run the position oracle (design.md → Method). Gate: **zero `ok→off` transitions** against head, and every remaining off-boundary start must land on a literal U+FFFD in the source — that is the tier 1 signature from Decision 4. A wrong start on anything else is a new defect, not the known residual.
- [ ] 3.4 Add the U+FFFD-bearing linearity regression from "Acceptance criteria" § 5, and confirm both it and the existing "grows linearly with input size" test are green. 2.3 removes the guard the tier 2 skip lives in, so this is the test that catches getting it backwards. AGENTS.md is explicit that neither is to be weakened to accommodate a slow machine — raise the base size instead.
- [ ] 3.5 Spot-check a handful of the 461 inputs (10k sweep) that succeed on both sides with different positions, and confirm the new positions are the correct ones. These are baseline silent mis-anchorings, so they are the fix working, not a regression.
- [ ] 3.6 Run the change against the multibyte fixtures. **The gte-small leg was not run in the spike** — `@huggingface/transformers` is not a devDependency — so either run it here or hand it to `tokenizer-length-inflation` explicitly (see 6.2). Do not record it as passed.

## 4. Reconcile the spec delta with what actually shipped

- [ ] 4.1 [specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md) is written for the measured behavior, including both residuals as stated exceptions. Confirm each still matches: the tier 1 exception (Decision 4), the decoy exception (Risks), and the removal of the U+FFFD linearity carve-out. If any measurement in task 3 came out differently, the delta moves — not the gate.
- [ ] 4.2 Two shipped scenarios have their outcome **inverted**: "Tier 2 attempted when the source itself contains U+FFFD" and "Source containing U+FFFD keeps the unbounded search (known limitation)". Both were written by `anchor-scan-short-circuit` as permanent facts about the problem; they were consequences of the disjunct. The delta format cannot drop a scenario from a MODIFIED requirement (`validate --strict` rejects it, and REMOVED/RENAMED do not reset the scenario set either), so both are retained with corrected bodies and now-stale titles.
- [ ] 4.3 After archiving, rename those two scenarios to match their bodies — a rename with no scenario-set change validates cleanly. Leaving titles that contradict their own outcomes is exactly the kind of stale framing that let this bug read as a perf footnote in the first place.
- [ ] 4.4 Run `openspec validate --all --strict` and fix any delta that fails.

## 5. Close the user-facing overclaim

- [ ] 5.1 Update README's "Supported tokenizers (and a known limitation)" section: the `tiktoken` line currently reads "✅ … substitutes exactly one U+FFFD per undecodable byte, so length matches source span" with normalizing tokenizers as the only caveat. State the literal-U+FFFD-in-source behavior including both exceptions.
- [ ] 5.2 Rewrite AGENTS.md's algorithm-map bullet "Tier 2 is skipped when it provably cannot match". After 2.3 the skip is no longer provable-equivalence only — it is equivalence for a clean source and a deliberate correctness preference for a U+FFFD-bearing one. Add the tier 3 left-edge rule next to it, and note that the two edits are a pair.
- [ ] 5.3 Update AGENTS.md's "Quadratic tier-2 anchor scan" entry under "Open work / future": that change's carve-out for a U+FFFD-bearing source is now closed, with the measurement (40.8x → 10.7x cost for an 8x span).
- [ ] 5.4 Add a changeset (`npx changeset`). Positions and chunk counts change for affected inputs, so this is **not** a patch — it needs the same "regenerate persisted embeddings / citation offsets" note the `0.3.0` rewrite carries.

## 6. Hand off what is not done

- [ ] 6.1 Update `openspec/changes/tokenizer-length-inflation/research.md:36-43` — it currently records this shape as an open "fourth instance of the same root cause". Note what this change fixed and what residual remains. Also correct the overlap assessment: that change's tier 3 replacement is gated on `sourceNormalize`, so the default-path offset fix here survives it untouched.
- [ ] 6.2 Hand the unrun gte-small verification (3.6) to `tokenizer-length-inflation` if it was not run here, since that change owns those tokenizers and edits the same tier 3 region.
- [ ] 6.3 Capture the backtracking anchor walk from design.md → Open Questions as its own follow-up. It is the only remaining way to close the decoy class and the tier 1 residual, and Decision 4 proves nothing local can — that conclusion should not live only in an archived change's Open Questions.
- [ ] 6.4 `openspec archive literal-replacement-char-anchoring` once `npm run check` is green.
