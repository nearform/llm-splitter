## Context

`anchorParts` in [src/split.js](../../../../src/split.js) infers each part's offset by searching the
source. Three residual defects are wrong inferences, and none is fixable from the text:

| defect                                                    | scope                                            |
| --------------------------------------------------------- | ------------------------------------------------ |
| Tier 2 takes the first verbatim match                     | **489 of 20,000 (2.4%) on a U+FFFD-free corpus** |
| Tier 3 candidate a one-character skeleton cannot rule out | 158 of 15,986                                    |
| Tier 1 manufactured vs literal U+FFFD                     | 7 oracle residual                                |

Reproduce the first with no Unicode involved:

```js
split("a....", { splitter: (t) => t.split("...").filter(Boolean) });
// parts ["a", "."]; the "." is at 4, reported start is 1
```

It reproduces identically on `chore/rewrite`, so it predates the rewrite branch.

**Why no local rule works.** In `"a...."` the `"."` can sit at 1, 2, 3, or 4 and every choice
tiles the source. The truth is 4 only because `String.split` consumes separators left-to-right —
information that never reaches `split()`, which sees only the resulting strings.

## Goals / Non-Goals

**Goals:**

- A splitter that knows its offsets can report them and get exact positions.
- Zero behavior change for bare-string splitters, including the default.
- Cover the common delimiter case without callers doing offset arithmetic.

**Non-Goals:**

- Improving the anchoring search. This change routes around it; the tiers are untouched.
- Making reporting mandatory, or changing any default.
- Normalizing tokenizers (`tokenizer-length-inflation`). Reporting a `start` does not help: `end`
  is still `start + text.length`, so an inflating part overshoots the cursor and the next honest
  offset is rejected as backwards. Closing that would need the reported form to carry the consumed
  span — a separate decision, not this change.

## Decisions

### Decision 1: A union return type, not a second option

**Chosen.** `splitter` may return `Array<string | { text, start }>`.

Rejected alternatives:

- **A separate `positionedSplitter` option.** Two options that must not both be set, and callers
  wrapping a tokenizer would have to pick one up front. The union lets a splitter report only the
  offsets it knows.
- **Always return objects (breaking).** Every existing splitter breaks for a feature most callers
  do not need.
- **Return a parallel offsets array.** Two arrays whose lengths must agree, with no way to report
  partially.

### Decision 2: Trust the offset, validate the shape

A reported `start` is used even when `input.slice(start, start + text.length) !== text`, because a
byte-mutating splitter legitimately returns text differing from its source span — rejecting a
mismatch would exclude `tiktoken`, the primary use case. What _is_ rejected is a structurally
impossible offset: non-integer, negative, beyond the input, or one that moves the cursor
backwards. The last would make chunks overlap without `chunkOverlap` asking, breaking the coverage
contract, so it throws rather than being clamped.

This asymmetry is the crux: the library cannot check whether a reported offset is _correct_, only
whether it is _possible_. Reporting positions moves that trust to the splitter, which is the point
— the splitter is the only party that knows.

### Decision 3: Widening `splitter` breaks one assignment, and that is unavoidable

Widening a parameter type is safe for callers passing a splitter. It is not safe for a caller who
holds the _function type itself_ and assigns to it — `const f: SplitOptions["splitter"] = mySplit`
still compiles, but code that assigns `SplitOptions["splitter"]` to a narrower
`(s: string) => string[]` variable stops compiling. The same shape as the overload-set note in
AGENTS.md. Probed in both directions under `nodenext` and `bundler`: confirmed, exactly there and
nowhere else.

**Putting the union member behind a distinct exported type does not help, so do not re-propose it.**
Measured against the same probe, alongside a union return type: all three accept both splitter
forms and all three fail the assignment back, because any type permitting a `{ text, start }[]`
return is by construction not assignable to `=> string[]`. The break follows from the feature
living on the `splitter` option, not from how the option was typed. The only shape that survives is
a separate `positionedSplitter` option — Decision 1, rejected on its own merits.

Accepted as shipped. The affected caller must hold the option type and re-narrow it, which is
uncommon, and the fix is one annotation: `SplitOptions["splitter"]`.

### Decision 4: `delimiterSplitter` computes offsets while scanning

Implemented with `indexOf` in a loop rather than `String.split`, since `split` discards the
positions this exists to report. Empty parts are omitted to match the `filter(Boolean)` idiom the
README already uses.

## Measured dead ends

Recorded so they are not re-proposed. All three were measured against the corpus in
[the decoy change](../2026-08-21-decoy-grapheme-anchoring/design.md):

| candidate                                        | result                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| One-part lookahead (that change's Open Question) | **fixes 0 of 124** — at the decoy the next part is still findable further on |
| Rightmost-greedy instead of leftmost             | **worse**: 578 vs 489; fixes 245, breaks 334                                 |
| Skeleton verification applied to Tier 2          | vacuous — a verbatim match aligns at every position                          |

A global alignment search is also rejected: `"a...."` admits four valid alignments, so it needs an
objective function nobody has justified, and it reintroduces the per-part cost
`anchor-scan-short-circuit` removed.

## Risks / Trade-offs

- **[Wrong offsets from a caller are unverifiable]** → Documented as the splitter's contract.
  Validation catches impossible offsets, not incorrect ones.
- **[New public surface]** → Two additions (`delimiterSplitter`, `SplitterPart`) and one widened
  type. Needs a minor version and a changeset.
- **[Two positioning paths to keep in step]** → The reported path must respect the same cursor and
  coverage rules. Mitigated by running the existing coverage fuzz with a reporting splitter, not
  only a bare one.
- **[Overlap with `tokenizer-length-inflation`]** → Both touch `anchorParts`. Whichever lands
  second rebases. Reporting positions is the more general fix, so that change should be re-scoped
  to normalizing splitters that _cannot_ report.

## Open Questions

- Should the default character splitter report positions? It knows them trivially, and doing so
  would exercise the path on every default call — attractive for coverage, but it changes the
  code path for the most common case, so measure first.
- Does `chunkStrategy: "paragraph"` want `delimiterSplitter` internally? Paragraph mode already
  tracks its own `baseOffset`; unifying them is tempting and out of scope here.
