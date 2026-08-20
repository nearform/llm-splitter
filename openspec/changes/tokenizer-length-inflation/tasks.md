## 1. Phase 1 — regression fixtures (complete)

- [x] 1.1 Add `@huggingface/transformers` as a dev dependency
- [x] 1.2 Lazy-load `Xenova/gte-small` in a `before()` hook gated by `B7_TEST=1`
- [x] 1.3 Land `gteSmallSplitterNaive` / `gteSmallSplitter` helpers and the five fixtures in the `regressions` block of `test/split.test.js`
- [x] 1.4 Capture the failure-mode analysis in this change's `research.md`

## 2. Phase 2 — `sourceNormalize` API

- [ ] 2.1 Add `sourceNormalize` to the `SplitOptions` typedef in `src/split.js` (optional, default identity)
- [ ] 2.2 Validate `sourceNormalize` in `splitValidate` (must be a function when provided)
- [ ] 2.3 Thread `sourceNormalize` through `boundaryGroups` → `anchorParts`

## 3. Phase 2 — anchoring changes

- [ ] 3.1 Pre-anchor: detect zero-source-span parts (no anchorable graphemes, e.g. `[CLS]`) and skip them without advancing the cursor
- [ ] 3.2 Replace Tier 3 with a normalized forward scan when `sourceNormalize` is non-identity: find first source `i` where `sourceNormalize(source[i..])` starts with `sourceNormalize(part)`
- [ ] 3.3 Keep Tiers 1–2 byte-identical to today when `sourceNormalize` is identity (no regression on char/whitespace/tiktoken)
- [ ] 3.4 Preserve the `chunk-coverage` invariant (`end` extension unchanged)

## 4. Tests

- [ ] 4.1 Re-add the synthetic drift-splitter regression as an asserting test in `test/split.test.js` (repro + expected result in this change's `design.md` → "Acceptance criteria"; it was extracted out of the suite to keep `npm test` clean while B7 is open)
- [ ] 4.2 Turn the `B7_TEST=1` `gte-small` fixtures from coverage-only assertions into exact-position assertions
- [ ] 4.3 Confirm no regression on the tiktoken multibyte fixtures, especially the Devanagari case `"Hindi: नमस्ते दुनिया"` that broke the reverted hybrid-cursor attempt
- [ ] 4.4 Run `B7_TEST=1 npm test` (downloads `gte-small`) and confirm green

## 5. Performance & docs

- [ ] 5.1 Run `node tmp-benchmark-rewrite.js` and confirm no regression vs published `llm-splitter@0.2.0` (Tiers 1–2 untouched)
- [ ] 5.2 Update the README "Supported tokenizers (and a known limitation)" section to document `sourceNormalize`
- [ ] 5.3 Update the AGENTS.md "Open work / future" section once B7 is closed

## 6. Follow-up (out of scope for this change)

- [ ] 6.1 Broaden regression coverage to `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, `multilingual-e5-small`
