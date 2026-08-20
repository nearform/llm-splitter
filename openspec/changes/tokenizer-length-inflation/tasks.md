## 1. Phase 1 — evidence (complete)

- [x] 1.1 Build the `gteSmallSplitterNaive` / `gteSmallSplitter` helpers and the five fixtures, and record what each one fails on
- [x] 1.2 Park the fixture code in this change's `design.md` → "Acceptance criteria" §2. It briefly lived in `test/split.test.js` behind an env gate; that and the `@huggingface/transformers` dev dependency were both removed so the suite stays unconditional and green and `npm ci` stays light.
- [x] 1.3 Capture the failure-mode analysis in this change's `research.md`

## 2. Phase 2 — `sourceNormalize` API

- [ ] 2.1 Add `sourceNormalize` to the `SplitOptions` typedef in `src/split.js` (optional, default identity)
- [ ] 2.2 Validate `sourceNormalize` in `splitValidate` (must be a function when provided)
- [ ] 2.3 Thread `sourceNormalize` through `boundaryGroups` → `anchorParts`

## 3. Phase 2 — anchoring changes

- [ ] 3.1 Replace Tier 3 with a normalized **span** scan when `sourceNormalize` is non-identity: find the first source `i` where `sourceNormalize(source[i..])` starts with `sourceNormalize(part)`, then the shortest `j > i` where `sourceNormalize(source[i..j]) === sourceNormalize(part)`; set `start = i`, `end = j`, cursor `= j`. Deriving `end` (not `start + part.length`) is the part that fixes `"##ん"` — see design.md, "Settled: the scan returns a span"
- [ ] 3.2 Bound the scan at a small multiple of the part's normalized length. This is a per-part forward scan — the same shape as the tier 2 scan that made `character` splits quadratic — so it needs a limit and a scaling regression, not just a correctness test (design.md, same section)
- [ ] 3.3 Throw for an unlocatable part (normalized form absent within the window), with a message naming the part and pointing at control-token filtering. No in-library control-token detection: `[CLS]` is anchorable on its `[` and cannot be told apart from ordinary source text — design.md, Decision 3
- [ ] 3.4 Keep Tiers 1–2 byte-identical to today when `sourceNormalize` is identity, including the length-based advance (no regression on char/whitespace/tiktoken)
- [ ] 3.5 Preserve the `chunk-coverage` invariant (`end` extension unchanged)

## 4. Tests

- [ ] 4.1 Add the synthetic drift-splitter regression to `test/split.test.js` as an asserting test (repro + expected result in `design.md` → "Acceptance criteria" §1). Give the fixture a `sourceNormalize` — the identity path is deliberately unchanged, so without one it documents the unsupported default rather than asserting the fix
- [ ] 4.2 Re-add `@huggingface/transformers` as a dev dependency, then wire in the gte-small fixtures from `design.md` → "Acceptance criteria" §2 — upgraded from coverage-only to exact-position assertions, using the filtering `gteSmallSplitter`; `gteSmallSplitterNaive` stays a documented failure, asserting the loud throw from task 3.3 — and decide how they are gated
- [ ] 4.3 Add a scaling regression for the bounded normalized scan (task 3.2), in the shape of the "anchoring cost" test the archived `anchor-scan-short-circuit` left behind
- [ ] 4.4 Confirm no regression on the tiktoken multibyte fixtures, especially the Devanagari case `"Hindi: नमस्ते दुनिया"` that broke the reverted hybrid-cursor attempt
- [ ] 4.5 Run the full suite including the gte-small fixtures (downloads `Xenova/gte-small`) and confirm green

## 5. Docs

- [ ] 5.1 Update the README "Supported tokenizers (and a known limitation)" section to document `sourceNormalize`, and state the splitter-side requirement to filter tokenizer control tokens (with the `gteSmallSplitter` filter as the worked example)
- [ ] 5.2 Update the AGENTS.md "Open work / future" section once this change is closed

## 6. Follow-up (out of scope for this change)

- [ ] 6.1 Broaden regression coverage to `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, `multilingual-e5-small`
