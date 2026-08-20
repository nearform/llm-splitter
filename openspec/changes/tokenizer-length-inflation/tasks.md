## 1. Phase 1 — evidence (complete)

- [x] 1.1 Build the `gteSmallSplitterNaive` / `gteSmallSplitter` helpers and the five fixtures, and record what each one fails on
- [x] 1.2 Park the fixture code in this change's `design.md` → "Acceptance criteria" §2. It briefly lived in `test/split.test.js` behind an env gate; that and the `@huggingface/transformers` dev dependency were both removed so the suite stays unconditional and green and `npm ci` stays light.
- [x] 1.3 Capture the failure-mode analysis in this change's `research.md`

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

- [ ] 4.1 Add the synthetic drift-splitter regression to `test/split.test.js` as an asserting test (repro + expected result in `design.md` → "Acceptance criteria" §1)
- [ ] 4.2 Re-add `@huggingface/transformers` as a dev dependency, then wire in the gte-small fixtures from `design.md` → "Acceptance criteria" §2 — upgraded from coverage-only to exact-position assertions — and decide how they are gated
- [ ] 4.3 Confirm no regression on the tiktoken multibyte fixtures, especially the Devanagari case `"Hindi: नमस्ते दुनिया"` that broke the reverted hybrid-cursor attempt
- [ ] 4.4 Run the full suite including the gte-small fixtures (downloads `Xenova/gte-small`) and confirm green

## 5. Docs

- [ ] 5.1 Update the README "Supported tokenizers (and a known limitation)" section to document `sourceNormalize`
- [ ] 5.2 Update the AGENTS.md "Open work / future" section once this change is closed

## 6. Follow-up (out of scope for this change)

- [ ] 6.1 Broaden regression coverage to `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, `multilingual-e5-small`
