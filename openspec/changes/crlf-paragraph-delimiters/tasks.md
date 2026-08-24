## 1. Implementation

- [ ] 1.1 Replace the single `PARAGRAPH_DELIMITER` constant in `src/split.js` (`boundaryGroups`) with an earliest-match scan over both delimiters — `indexOf("\n\n")` vs `indexOf("\r\n\r\n")`, take whichever comes first — so the consumed length stays known for cursor arithmetic (a regex split would discard which delimiter matched)
- [ ] 1.2 Confirm trimming is unaffected: `/^\s+/` and `/\s+$/` already strip stray `\r`; verify no paragraph gains a leading/trailing `\r` after the change

## 2. Tests

- [ ] 2.1 Mirror the core paragraph cases with CRLF input: grouping, oversized paragraph, early emission, overlap interaction (`test/split.test.js` → "paragraph strategy")
- [ ] 2.2 Lone `\r\n` does not break paragraphs (spec scenario 2)
- [ ] 2.3 Repeated-paragraph anchoring still lands on real offsets when the delimiter differs (`paragraph group offsets` suite)
- [ ] 2.4 Extend the coverage-invariant check to a CRLF fixture; delimiters absorbed by the preceding chunk
- [ ] 2.5 Run the multibyte/tokenizer fixtures to confirm no anchoring regression (delimiter change touches group boundaries only)

## 3. Docs

- [ ] 3.1 README paragraph section: "`\n\n`" → "`\n\n` or `\r\n\r\n`"
- [ ] 3.2 AGENTS.md algorithm map mentions of `PARAGRAPH_DELIMITER`
- [ ] 3.3 Changeset for the behavior change
