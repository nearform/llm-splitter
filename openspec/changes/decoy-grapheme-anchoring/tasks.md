## 0. Decide whether to ship at all

- [ ] 0.1 Re-read [design.md](./design.md) → Decision 2 before starting. This change is filed
      deliberately, not blocked: the defect is bounded, coverage-safe, and largely — not
      wholly — mitigated by `chunkOverlap: 2` or more, which at `chunkSize: 8` takes tokens
      left whole in no chunk from 275 to 2, reaching 0 only at `chunkOverlap: 4`. The
      mitigation is also opt-in, and `chunkOverlap` defaults to `0`. Against that, the fix is
      a 25-line change to the anchoring strategy
      that leaves 395 of 15,986 cases wrong against the merge base's 258. Two things justify
      picking it up: a report from someone using a multi-character string delimiter over
      U+FFFD-bearing text at `chunkOverlap: 0` and depending on exact boundaries, or a
      decision to close the remainder properly, in which case this is the first half.
- [ ] 0.2 Confirm the numbers still hold before trusting them. They were measured against the
      merge base of `chore/rewrite-chars-issue` and the head of that branch; if `anchorParts`
      has moved since, re-run § 3 first and update design.md rather than reasoning from stale
      figures.

## 1. Pin the failures

- [ ] 1.1 Add the paragraph-splitter regression from [design.md](./design.md) → "Acceptance
      criteria" § 1 to `test/split.test.js`, and confirm it **fails** at head, reporting
      `[[0,6],[6,22],[22,26]]` against the expected `[[0,8],[8,22],[22,26]]` — the misplaced boundary is the first chunk's `end` and the second's `start`, not the first chunk alone.
- [ ] 1.2 Add the decoy regression from "Acceptance criteria" § 2 and confirm it also fails at
      head. It carries no dependence on a delimiter shape, so it survives if the paragraph
      case is ever reshaped.
- [ ] 1.3 Confirm both cases pass at the merge base of `literal-replacement-char-anchoring`.
      They are regressions introduced by that change, not longstanding defects, and a test
      that also fails before it would be testing something else.

## 2. Apply the fix

- [ ] 2.1 Add `skeletonAligns` to [src/split.js](../../../src/split.js) per design.md →
      Decision 1, reusing `REPLACEMENT_CHAR` and `UNANCHORABLE_CLUSTER`. No new predicate.
- [ ] 2.2 Wrap the tier 3 locate in the rejection loop, advancing from `match + 1` on failure.
      Keep `- anchor.offset` and the `cursor + anchor.offset` search start exactly as they are;
      both are separately pinned and both are load-bearing for reasons unrelated to this
      change.
- [ ] 2.3 Comment the loop with why verification is not vacuous here but would be on a tier 2
      match — a tier 2 hit is verbatim and therefore already aligned, a tier 3 candidate has
      matched one grapheme. Without that, the natural "simplification" is to apply it to tier 2
      as well, or to conclude it does nothing.
- [ ] 2.4 Confirm both § 1 regressions pass and `npm run check` is green.

## 3. Verify against the measurements

- [ ] 3.1 Run the harness in
      `openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md` →
      "Reproducing the measurements" against an unpatched and a patched tree. Gate: every gate
      it prints matches what head already produces — zero throws on all three sweeps, zero
      `OK→THROW`, zero invariant violations, `ok→off` zero, same positions-moved counts. This
      change must be invisible to every existing gate.
- [ ] 3.2 Re-run the multi-character-dropping differential from design.md → Decision 1. Gate:
      **at or below 395** of 15,986, against 906 at head. Record the number here.
- [ ] 3.3 Confirm both "anchoring cost" scaling regressions stay green. The rejection loop is a
      per-part search, the shape that made `character` splits quadratic once before, so this is
      a gate rather than a formality. Prototype measured 7.2x for an 8x span.
- [ ] 3.4 Spot-check that the residual cases are the shape design.md → Risks predicts — a part
      that is mostly U+FFFD with one or two real code units, where an earlier offset aligns on
      all of them. A residual of a different shape means the mechanism is not understood.

## 4. Reconcile the spec

- [ ] 4.1 [specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md) narrows the
      decoy exception to what verification cannot resolve, and adds the verification step to
      "Three-tier locate strategy". Confirm the narrowed wording matches the measured residual;
      if § 3.2 came in materially different, the delta moves.
- [ ] 4.2 Run `openspec validate --all --strict`. Note the delta restates every scenario in the
      two modified requirements, including ones this change does not touch — a MODIFIED
      requirement replaces the whole block and validation rejects a dropped scenario.

## 5. Docs

- [ ] 5.1 Update the README's "Multibyte / Unicode Strings" section. It currently documents the
      exception together with the measured impact and the `chunkOverlap: 2` workaround; the
      workaround guidance stays useful, but the numbers change and the exception narrows.
- [ ] 5.2 Update AGENTS.md's algorithm map: the tier 3 bullet gains the verification step, and
      the "Backtracking anchor walk" entry narrows to what is genuinely left (the remaining 395
      and the tier 1 residual) now that the cheap local rule has shipped.
- [ ] 5.3 Add a changeset. Positions change for affected inputs, so this is not a patch and
      needs the "regenerate persisted embeddings / citation offsets" note. Say plainly that it
      only moves positions the previous behaviour got wrong.

## 6. Hand off what is not done

- [ ] 6.1 Record the remaining 395 and the tier 1 residual as the scope of the backtracking
      follow-up in AGENTS.md → "Open work / future", replacing the current entry's claim that
      no local rule helps (already corrected there, but it will need re-narrowing once this
      ships).
- [ ] 6.2 Evaluate the one-part-lookahead idea from design.md → Open Questions before reaching
      for full backtracking, and record the measurement either way.
- [ ] 6.3 `openspec archive decoy-grapheme-anchoring` once `npm run check` is green.
