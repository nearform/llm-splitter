## 1. Pin the defect first

- [x] 1.1 Added and confirmed failing before any code change: `[0, 1]` against an expected
      `[0, 4]`. Since bare-string behavior is deliberately unchanged (gate 4.4), the shipped pair
      under "reported positions" is a bare-string test characterizing `[0, 1]` as the limitation
      plus a `delimiterSplitter` test asserting `[0, 4]` as the remedy.
- [x] 1.2 Confirmed on a pristine `chore/rewrite` copy of `src/`: same `[0, 1]`. Pre-existing.

## 2. Reported-position path

- [x] 2.1 Add a `SplitterPart` typedef (`string | { text: string, start: number }`) and widen the
      `splitter` JSDoc on `SplitOptions`.
- [x] 2.2 `normalizePart` does the normalizing; the three tiers moved verbatim into `locatePart`,
      which `anchorParts` calls only when `start` is `null`. Extracting rather than nesting keeps
      the tier bodies byte-identical and makes "reported parts never reach the search" structural.
      Gate 4.4 is what proves the tiers did not move.
- [x] 2.3 Validate reported offsets per the spec — integer, `0 <= start <= input.length`, not
      behind the cursor — throwing `TypeError` with the part and offset named. Do **not** validate
      that `text` matches the source there; design.md → Decision 2 says why.
- [x] 2.4 Both branches fall through to one `end` computation and one `cursor = end`, so the
      coverage pass is untouched.

## 3. `delimiterSplitter`

- [x] 3.1 Implement in a new `src/delimiter-splitter.js` using `indexOf` in a loop, omitting empty
      parts. Export from `src/index.js`.
- [x] 3.2 Covered in `test/delimiter-splitter.test.js`, plus delimiters-only and empty input.
- [x] 3.3 Reject an empty-string delimiter explicitly — it would loop forever.

## 4. Verify nothing else moved

- [x] 4.1 Green. 174 tests -> 200; the 26 added are all new (13 reported-position, 12
      `delimiterSplitter`, 1 package-root export). No existing test changed.
- [x] 4.2 Four reporting splitters added to the contract fuzz's `SPLITTERS`
      (`reported-codepoint`, two `delimiterSplitter`s, and `mixed-reported` alternating the two
      forms), so both paths run the identical assertions. Green. Off-suite sweep at higher volume:
      172,235 cases over 5 seeds x 7 reporting splitters x both strategies x string and array
      input, zero violations.
- [x] 4.3 Both green on three consecutive runs. Measured side by side against `chore/rewrite` for
      an 8x span (threshold 16): clean source 2.3x -> 2.6x, U+FFFD source 7.9x -> 2.8x.
- [x] 4.4 **Identical.** Base `chore/rewrite` vs this tree: `wrong=395` both sides, parts dropped
      `1961` both sides, coverage broken 0, and every `chunkOverlap` row equal. Invisible to it.
- [x] 4.5 **0 mis-anchored**, over the same corpora and the same round-trip filter. By splitter
      shape, bare -> `delimiterSplitter`: `"..."` 2424 -> 0, `". "` 5140 -> 0, `"\n\n"` 1566 -> 0.
      On the class corpus, 15,212 of 15,986 cases round-trip through `delimiterSplitter` and score
      `wrong=0`, `dropped=0`, `coverage broken=0` — against 395 and 1961 for the bare form. The
      774 that do not round-trip are cases where a generated part contains the separator, so the
      corpus's ground truth describes a different segmentation than any delimiter splitter can
      produce; they are excluded rather than counted, exactly as the bare harness excludes them.
- [x] 4.6 Exactly as Decision 3 predicted, under both `nodenext` and `bundler`. Narrow ->
      `SplitOptions["splitter"]` compiles, including every call form and `chunk.text` narrowing;
      `SplitOptions["splitter"]` -> `(input: string) => string[]` fails with TS2322. That one
      direction is a real source break for a caller who holds the function type and re-assigns it,
      so the changeset names it rather than claiming the widening is free.

## 5. Docs

- [x] 5.1 Added "Reported positions" under Custom Splitter Functions, a `delimiterSplitter` API
      entry, and a feature bullet. The failure-mode list went from three to four — the tier 2
      verbatim decoy was the largest of them and the README never named it — with the remedy
      stated once at the top of the list instead of per-bullet, and the U+FFFD bullet tightened.
      Also added reporting positions as a third workaround under the length-inflation section.
- [x] 5.2 That entry had already been renamed to "The three residual anchoring defects"; it now
      leads with the remedy and frames the dead ends as reasons not to refine the search. The
      algorithm map also gained `normalizePart` / `locatePart`, since `anchorParts` no longer holds
      the tiers. Note `openspec/specs/multibyte-anchoring/spec.md` still cites the old
      "Backtracking anchor walk" name — left for `openspec archive` to reconcile (6.3).
- [x] 5.3 `.changeset/olive-moons-report.md`, minor. Leads with the new capability, states plainly
      that no positions change for existing callers, and names the one type assignment that breaks
      (4.6) rather than calling the widening free.

## 6. Follow-ups, not this change

- [ ] 6.1 `tokenizer-length-inflation` is untouched by this change — reporting a `start` does not
      sidestep inflation, because `end` is still `start + text.length`. Verified: a splitter
      reporting true offsets for parts that decode longer than their source span throws
      `behind the previous part's end`. If that change wants to build on reporting, the reported
      form needs to carry the consumed span (an `end`, or a length), which is a new decision.
- [ ] 6.2 Answer design.md → Open Questions on the default splitter reporting its own positions.
- [ ] 6.3 `openspec archive splitter-reported-positions` once green. **Archiving shifts relative
      link depth — re-check every `](../` link in the archived copy afterwards.**
