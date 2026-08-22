## 1. Pin the defect first

- [ ] 1.1 Add the U+FFFD-free Tier 2 regression to `test/split.test.js`:
      `split("a....", { chunkSize: 1, splitter: (t) => t.split("...").filter(Boolean) })` expects
      starts `[0, 4]` and reports `[0, 1]` today. Confirm it fails before any code change. Use a
      bare-string splitter so it pins the _defect_, not the new API.
- [ ] 1.2 Confirm it also fails on `chore/rewrite`. It is pre-existing, and a test that only fails
      after the rewrite would be pinning something else.

## 2. Reported-position path

- [ ] 2.1 Add a `SplitterPart` typedef (`string | { text: string, start: number }`) and widen the
      `splitter` JSDoc on `SplitOptions`.
- [ ] 2.2 In `anchorParts`, normalize each returned element to `{ text, start }` where `start` is
      `null` for a bare string, then branch: a reported `start` skips all three tiers, `null` runs
      them unchanged. Keep the tier code untouched so a bare-string splitter is provably unaffected.
- [ ] 2.3 Validate reported offsets per the spec — integer, `0 <= start <= input.length`, not
      behind the cursor — throwing `TypeError` with the part and offset named. Do **not** validate
      that `text` matches the source there; design.md → Decision 2 says why.
- [ ] 2.4 Confirm `end = min(start + text.length, input.length)` and the cursor advance are shared
      with the inferred path, so the coverage pass needs no change.

## 3. `delimiterSplitter`

- [ ] 3.1 Implement in a new `src/delimiter-splitter.js` using `indexOf` in a loop, omitting empty
      parts. Export from `src/index.js`.
- [ ] 3.2 Cover the spec scenarios: the `"a...."` case, consecutive delimiters, delimiter absent,
      delimiter at the start and at the end, and a multi-character delimiter.
- [ ] 3.3 Reject an empty-string delimiter explicitly — it would loop forever.

## 4. Verify nothing else moved

- [ ] 4.1 `npm run check` green, and confirm the count only grows by the new tests.
- [ ] 4.2 Re-run the existing coverage fuzz with a _reporting_ splitter as well as a bare one. The
      new path must satisfy the same coverage contract; this is the main risk in design.md.
- [ ] 4.3 Confirm both "anchoring cost" scaling regressions are unchanged. The reported path skips
      the search entirely, so it should if anything be faster — a regression means the branch is in
      the wrong place.
- [ ] 4.4 Re-run the differential from
      [the decoy change](../archive/2026-08-21-decoy-grapheme-anchoring/design.md) →
      "Reproducing the measurements" with bare-string splitters. Gate: **identical** to current
      head (395, and the parts-dropped column unchanged). This change must be invisible to it.
- [ ] 4.5 Then re-run it with `delimiterSplitter`. Gate: **0** mis-anchored. Record both numbers.
- [ ] 4.6 Probe the type widening per design.md → Decision 3, both assignment directions.

## 5. Docs

- [ ] 5.1 README: document the reported form and `delimiterSplitter` under the splitter section,
      and in "Known limitations" replace the three residual descriptions' dead ends with a pointer
      to the remedy. Tighten while there — that section is one very long paragraph.
- [ ] 5.2 AGENTS.md: the "Backtracking anchor walk" entry is superseded. Replace it with the
      reported-position remedy and keep only the measured dead ends, which are the reusable part.
- [ ] 5.3 Changeset, minor. New API plus a widened type; no positions change for existing callers,
      which is the thing to say plainly.

## 6. Follow-ups, not this change

- [ ] 6.1 Re-scope `tokenizer-length-inflation` to normalizing splitters that cannot report
      positions, since reporting removes the length assumption for those that can.
- [ ] 6.2 Answer design.md → Open Questions on the default splitter reporting its own positions.
- [ ] 6.3 `openspec archive splitter-reported-positions` once green. **Archiving shifts relative
      link depth — re-check every `](../` link in the archived copy afterwards.**
