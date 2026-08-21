## 1. Pin the failure before changing anything

- [ ] 1.1 Add the real-tokenizer regression from [design.md](./design.md) → "Acceptance criteria" § 1 to `test/split.test.js`, and confirm it **fails** at head with `Splitter returned a part that could not be located in input`.
- [ ] 1.2 Add the splitter-only synthetic from "Acceptance criteria" § 2 and confirm it also fails at head. Two independent repros, so the regression survives the `tiktoken` devDependency being dropped.
- [ ] 1.3 Record the baseline control result in the test comment: `"漢 hello world X tail"` succeeds with `[{ text: " hello world X tail", start: 1, end: 20 }]`, which is what makes the U+FFFD the isolated cause rather than the multi-byte character.

## 2. Apply the fix

- [ ] 2.1 In `anchorParts` ([src/split.js](../../../src/split.js)), replace the tier 2 guard's `sourceHasReplacement ||` disjunct with the bare/mixed form from design.md → Decision 1, reusing the existing `ONLY_REPLACEMENT_CHARS`.
- [ ] 2.2 Comment the call site with _why_ the test is bare-vs-mixed rather than contains-vs-not: a bare U+FFFD part is byte-identical whether manufactured or passed through, so its verbatim match carries no locating information. Design.md → Decision 1 records that the obvious simplification (drop the disjunct entirely) fails 2 of 167 tests, so this comment is what stops it being "simplified" back.
- [ ] 2.3 Confirm both § 1 regressions now pass and `npm test` is 167/167 + the 2 new tests.

## 3. Verify against the measurements, not just the suite

- [ ] 3.1 Re-run the differential fuzz from design.md → Decisions (3,000 cases, U+FFFD-bearing corpus, same seed on a patched and an unpatched tree). Gate: **zero `OK→THROW` transitions** and **zero invariant violations**.
- [ ] 3.2 Record the final throw count in this file. The spike measured `820 → 119`; a materially different number means the corpus or the patch drifted and needs explaining before landing.
- [ ] 3.3 Confirm the "anchoring cost … grows linearly with input size" scaling regression is still green — 2.1 edits the same guard the tier 2 skip lives in, and AGENTS.md is explicit that this test is not to be weakened to accommodate a slow machine.
- [ ] 3.4 Spot-check a handful of the ~69 inputs that succeed on both sides with different chunk counts, and confirm the new positions are the correct ones (these are baseline silent mis-anchorings, so they are the fix working, not a regression).

## 4. Reconcile the spec delta with what actually shipped

- [ ] 4.1 **Blocking before archive.** [specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md) is written for the target behavior; Decision 1 leaves 119 residual throws on manufactured _mixed_ parts. Either close the residual (see design.md → Open Questions) or narrow the "A literal U+FFFD in the source does not misdirect anchoring" requirement to bare parts and add the mixed-part residual as a stated known limitation.
- [ ] 4.2 Whichever way 4.1 goes, keep the widened wording in "Anchoring cost is linear in input length" — the U+FFFD carve-out is a _cost_ carve-out, and the archived `anchor-scan-short-circuit` delta framing it as the only exposure is what let this bug read as a perf footnote.
- [ ] 4.3 Run `openspec validate --all --strict` and fix any delta that fails.

## 5. Close the user-facing overclaim

- [ ] 5.1 Update README's "Supported tokenizers (and a known limitation)" section: the `tiktoken` line currently reads "✅ … substitutes exactly one U+FFFD per undecodable byte, so length matches source span" with normalizing tokenizers as the only caveat. State the literal-U+FFFD-in-source behavior as it stands after 4.1.
- [ ] 5.2 Add the bare/mixed tier 2 distinction to AGENTS.md's algorithm map, next to the existing "Tier 2 is skipped when it provably cannot match" bullet. That bullet currently describes the skip as provable-equivalence only, which is exactly the reading this change complicates.
- [ ] 5.3 Add a changeset (`npx changeset`). Positions and chunk counts change for affected inputs, so this is **not** a patch — it needs the same "regenerate persisted embeddings / citation offsets" note the `0.3.0` rewrite carries.

## 6. Hand off what is not done

- [ ] 6.1 Update `openspec/changes/tokenizer-length-inflation/research.md:36-43` — it currently records this shape as an open "fourth instance of the same root cause". Note what this change fixed, what residual remains, and that its own fix must still be checked against this shape.
- [ ] 6.2 If 4.1 left the mixed-part residual open, capture the tier-2-match-validation refinement as its own follow-up rather than leaving it only in this change's Open Questions.
- [ ] 6.3 `openspec archive literal-replacement-char-anchoring` once 4.1 is settled and `npm run check` is green.
