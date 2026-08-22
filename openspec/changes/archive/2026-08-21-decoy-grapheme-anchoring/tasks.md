## 0. Decide whether to ship at all

- [x] 0.1 **Decided: ship.** Re-read [design.md](./design.md) → Decision 2, which now records
      the reversal. The filing decision rested on the fix looking partial (906 → 395 on the
      synthetic differential) and on `chunkOverlap` looking like a complete workaround. Both
      were weaker than recorded: against a real splitter the fix takes the class from 10.5% of
      U+FFFD-bearing documents to 0.0% at every density, and the workaround reaches 0 only at
      `chunkOverlap: 4` against a default of `0`.
- [x] 0.2 Numbers re-confirmed against `chore/rewrite`'s `src/` (the PR base, blob
      `03558db`) and this branch. The synthetic differential reproduces exactly
      (15,986 / 258 / 906 / 395) and the harness now also reports the parts-dropped column it
      previously discarded.

## 1. Pin the failures

- [x] 1.1 Add the paragraph-splitter regression from [design.md](./design.md) → "Acceptance
      criteria" § 1 to `test/split.test.js`, and confirm it **fails** at head, reporting
      `[[0,6],[6,22],[22,26]]` against the expected `[[0,8],[8,22],[22,26]]` — the misplaced boundary is the first chunk's `end` and the second's `start`, not the first chunk alone.
- [x] 1.2 Add the decoy regression from "Acceptance criteria" § 2 and confirm it also fails at
      head. It carries no dependence on a delimiter shape, so it survives if the paragraph
      case is ever reshaped.
- [x] 1.3 Confirmed: both pass at the PR base (`chore/rewrite`), fail pre-fix (`[[0,6],[6,22],[22,26]]` and `[[0,2],[2,7]]`), pass now. Original text: Confirm both cases pass at the merge base of `literal-replacement-char-anchoring`.
      They are regressions introduced by that change, not longstanding defects, and a test
      that also fails before it would be testing something else.

## 2. Apply the fix

- [x] 2.1 Add `skeletonAligns` to [src/split.js](../../../../src/split.js) per design.md →
      Decision 1, reusing `REPLACEMENT_CHAR` and `UNANCHORABLE_CLUSTER`. No new predicate.
- [x] 2.2 Wrap the tier 3 locate in the rejection loop, advancing from `match + 1` on failure.
      Keep `- anchor.offset` and the `cursor + anchor.offset` search start exactly as they are;
      both are separately pinned and both are load-bearing for reasons unrelated to this
      change.
- [x] 2.3 Comment the loop with why verification is not vacuous here but would be on a tier 2
      match — a tier 2 hit is verbatim and therefore already aligned, a tier 3 candidate has
      matched one grapheme. Without that, the natural "simplification" is to apply it to tier 2
      as well, or to conclude it does nothing.
- [x] 2.4 Both § 1 regressions pass; `npm run check` green at 174/174.

## 3. Verify against the measurements

- [x] 3.1 Run the harness in
      `openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md` →
      "Reproducing the measurements" against an unpatched and a patched tree. Gate: every gate
      it prints matches what head already produces — zero throws on all three sweeps, zero
      `OK→THROW`, zero invariant violations, `ok→off` zero, same positions-moved counts. This
      change must be invisible to every existing gate.
- [x] 3.2 **395 of 15,986**, exactly at the gate (906 pre-fix). The harness now also reports the parts-dropped column it used to discard: base 0, shipped 1,961. Re-run the multi-character-dropping differential from design.md → Decision 1. Gate:
      **at or below 395** of 15,986, against 906 at head. Record the number here.
- [x] 3.3 Both green. Confirm both "anchoring cost" scaling regressions stay green. The rejection loop is a
      per-part search, the shape that made `character` splits quadratic once before, so this is
      a gate rather than a formality. Prototype measured 7.2x for an 8x span.
- [x] 3.4 **Shape confirmed, and it split the residual in two.** Of 395 offending parts, 317 carry exactly one non-U+FFFD character and 70 carry two — as predicted. But 237 of the 395 contain **no U+FFFD at all**: those are tier 2 verbatim decoys, a pre-existing defect that reproduces identically at the base and that verification cannot reach. The residual attributable to this change's class is **158**. Recorded in AGENTS.md → "Backtracking anchor walk" as three separate bugs. Original text: Spot-check that the residual cases are the shape design.md → Risks predicts — a part
      that is mostly U+FFFD with one or two real code units, where an earlier offset aligns on
      all of them. A residual of a different shape means the mechanism is not understood.

## 4. Reconcile the spec

- [x] 4.1 [specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md) narrows the
      decoy exception to what verification cannot resolve, and adds the verification step to
      "Three-tier locate strategy". Confirm the narrowed wording matches the measured residual;
      if § 3.2 came in materially different, the delta moves.
- [x] 4.2 Passes, 6 items. Run `openspec validate --all --strict`. Note the delta restates every scenario in the
      two modified requirements, including ones this change does not touch — a MODIFIED
      requirement replaces the whole block and validation rejects a dropped scenario.

## 5. Docs

- [x] 5.1 Update the README's "Multibyte / Unicode Strings" section. It currently documents the
      exception together with the measured impact and the `chunkOverlap: 2` workaround; the
      workaround guidance stays useful, but the numbers change and the exception narrows.
- [x] 5.2 Update AGENTS.md's algorithm map: the tier 3 bullet gains the verification step, and
      the "Backtracking anchor walk" entry narrows to what is genuinely left (the remaining 395
      and the tier 1 residual) now that the cheap local rule has shipped.
- [x] 5.3 Folded into the existing `lucky-pandas-listen` changeset rather than a new one, since the U+FFFD bullet there described the behaviour this fixes. Add a changeset. Positions change for affected inputs, so this is not a patch and
      needs the "regenerate persisted embeddings / citation offsets" note. Say plainly that it
      only moves positions the previous behaviour got wrong.

## 6. Hand off what is not done

- [x] 6.1 Done, and split into three distinct bugs (tier 2 decoys 237, tier 3 residual 158, tier 1 case) — the single number was conflating them. Record the remaining 395 and the tier 1 residual as the scope of the backtracking
      follow-up in AGENTS.md → "Open work / future", replacing the current entry's claim that
      no local rule helps (already corrected there, but it will need re-narrowing once this
      ships).
- [ ] 6.2 Still open. Note it must now be evaluated against the tier 2 decoy class as well, which is the larger residual. Evaluate the one-part-lookahead idea from design.md → Open Questions before reaching
      for full backtracking, and record the measurement either way.
- [x] 6.3 `openspec archive decoy-grapheme-anchoring` once `npm run check` is green. **Archiving rewrites relative depth — re-check every `](../` link in the archived copy afterwards.**
