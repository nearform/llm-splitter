## Why

A splitter is `(input: string) => string[]`, so `split()` never learns where a part came from
and must guess its offset by searching the source. Every residual anchoring defect is a wrong
guess, and the largest one is not a Unicode problem at all:

```js
split("a....", { splitter: (t) => t.split("...").filter(Boolean) });
// parts ["a", "."] — the "." is at index 4; reported start is 1
```

Also `"hi. ."` on `". "` and `"x | |"` on `" | "`. This is plain ASCII, a real splitter, and it
reproduces identically on `chore/rewrite`, so it predates the rewrite branch. Measured at 489 of
20,000 randomized cases (2.4%) on a corpus containing no U+FFFD whatsoever.

Three local fixes have been measured and none works, because the information needed is not in
the text: the correct offset in `"a...."` is determined by `String.split` consuming separators
left-to-right, which `split()` cannot observe. Letting a splitter report positions removes the
guess instead of refining it.

## What Changes

- A splitter MAY return `Array<string | { text: string, start: number }>`. A reported `start`
  is used verbatim; a bare string keeps today's three-tier search. Mixing forms in one array is
  allowed, so a splitter can report positions only where it knows them.
- New exported helper `delimiterSplitter(delimiter)` returning a position-reporting splitter,
  so the common `text.split("\n\n")` case gets exact offsets without callers writing offset
  arithmetic.
- Reported positions are validated: non-integer, out of range, or non-monotonic `start` values
  throw rather than silently corrupting positions.
- The three-tier search is unchanged for bare-string splitters. No existing call site changes
  behavior, and no default changes.

## Capabilities

### New Capabilities

- `splitter-positions`: the position-reporting splitter contract — accepted return shapes,
  validation of a reported `start`, precedence over the anchoring search, and the
  `delimiterSplitter` helper.

### Modified Capabilities

- `multibyte-anchoring`: the three residual limitations (tier 2 verbatim decoy, tier 3
  one-character skeleton, tier 1 manufactured-vs-literal U+FFFD) gain a stated remedy rather
  than remaining unconditional. The anchoring search itself does not change.
- `chunking`: the "Custom splitter contract" requirement widens to allow a reported-position
  part.

## Impact

- `src/split.js` — `anchorParts` gains a reported-position path ahead of tier 1; `splitValidate`
  gains `start` validation.
- `src/index.js` — exports `delimiterSplitter`.
- Types — `SplitOptions["splitter"]` widens; a new exported `SplitterPart` type. Widening a
  parameter is source-compatible for callers, but see design.md → Decision 3 for the one
  assignability case that is not.
- Docs — README "Known limitations" gains the remedy; AGENTS.md → "Backtracking anchor walk"
  is superseded by this change.
- No new dependencies. `tokenizer-length-inflation` is **not** addressed by this change: a
  reported part still derives `end` from `start + text.length`, so an inflating splitter
  overshoots the cursor and its next honest offset is rejected as backwards. Reporting a start
  removes the _search_, not the length assumption.
