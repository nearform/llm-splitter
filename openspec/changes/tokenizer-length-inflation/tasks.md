## 1. Phase 1 — evidence (complete)

- [x] 1.1 Build the `gteSmallSplitterNaive` / `gteSmallSplitter` helpers and five fixtures; record what each fails on
- [x] 1.2 Park the fixture code in `design.md` → "Acceptance criteria" §2, so the suite stays unconditional and `npm ci` stays light
- [x] 1.3 Capture the failure-mode analysis in `research.md`

## 2. Phase 2 — `sourceNormalize` API

- [ ] 2.1 Add `sourceNormalize` to the `SplitOptions` typedef (optional, default identity)
- [ ] 2.2 Validate it in `splitValidate` (must be a function when provided)
- [ ] 2.3 Thread it through `boundaryGroups` → `anchorParts`

## 3. Phase 2 — anchoring changes

- [ ] 3.1 Replace Tier 3 with a normalized **span** scan when `sourceNormalize` is non-identity: find the first `i` where `sourceNormalize(source[i..])` starts with `sourceNormalize(part)`, then the shortest `j > i` where `sourceNormalize(source[i..j]) === sourceNormalize(part)`; set `start = i`, `end = j`, cursor `= j`. Deriving `end` rather than `start + part.length` is what fixes `"##ん"` — design.md, "Settled: the scan returns a span"
- [ ] 3.2 Bound the scan at a small multiple of the part's normalized length. It is a per-part forward scan, the shape that made `character` splits quadratic, so it needs a limit **and** a scaling regression
- [ ] 3.3 Throw for a part whose normalized form is absent within the window, naming the part and pointing at control-token filtering. No in-library control-token detection — `[CLS]` is anchorable on its `[` and cannot be told from ordinary source text (design.md, Decision 3)
- [ ] 3.4 Keep Tiers 1–2 byte-identical on the identity path, including the length-based advance. "Identical" means identical to `main` at rebase time: the U+FFFD tier 2 skip, the tier 3 anchor-offset subtraction, and `skeletonAligns` candidate verification all stay. **Do not carry `skeletonAligns` onto the normalized path** — it compares at fixed offsets, the exact assumption inflation breaks, so it would reject every correct candidate
- [ ] 3.5 Preserve the `chunk-coverage` invariant (`end` extension unchanged)

## 4. Tests

- [ ] 4.1 Add the synthetic drift-splitter regression as an asserting test (repro in `design.md` → "Acceptance criteria" §1). Give it a `sourceNormalize`; without one it documents the unsupported default instead of asserting the fix
- [ ] 4.2 Re-add `@huggingface/transformers` as a dev dependency and wire in the gte-small fixtures with exact-position assertions, using the filtering `gteSmallSplitter`. `gteSmallSplitterNaive` stays a documented failure asserting the throw from 3.3. Decide how they are gated
- [ ] 4.3 Add a scaling regression for the bounded normalized scan, shaped like the existing "anchoring cost" tests
- [ ] 4.4 Confirm no regression on the tiktoken multibyte fixtures, especially `"Hindi: नमस्ते दुनिया"` — it broke the reverted hybrid-cursor attempt
- [ ] 4.5 Run the full suite including the gte-small fixtures (downloads `Xenova/gte-small`)
- [ ] 4.6 Re-run the Phase 1 evidence table in `research.md` against the current identity path (`gteSmallSplitterNaive`, no `sourceNormalize`). Establish that the corrected Tier 3 does not turn a loud throw into a silent mis-anchor, and refresh the table. **Predicted inert**: the offset correction only bites when a part begins with U+FFFD or a combining mark, and every gte-small part in the table anchors at offset 0; the tier 2 skip only bites on U+FFFD-bearing parts, which normalizing tokenizers do not emit. A table that moves means that reasoning is wrong, and that is the finding

## 5. Docs

- [ ] 5.1 Document `sourceNormalize` in the README's "Supported tokenizers" section, plus the splitter-side requirement to filter control tokens (`gteSmallSplitter` as the worked example)
- [ ] 5.2 Update AGENTS.md "Open work" once this closes

## 6. Follow-up (out of scope)

- [ ] 6.1 Broaden regression coverage to `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, `multilingual-e5-small`
