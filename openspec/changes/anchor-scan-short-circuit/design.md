## Context

See [proposal.md](./proposal.md) — Why.

`anchorParts` resolves each splitter part through three tiers. Tier 1 (`startsWith` at the
cursor) and Tier 3 (`indexOf` of the first anchorable grapheme) both terminate near the
cursor in practice. Tier 2 (`indexOf(splitPart, cursor)`) does not: on failure it scans every
remaining code unit before returning `-1`. Nothing about the current code distinguishes "this
part is a little further along" from "this part is nowhere", so both pay the same worst case.

Two structural facts shape the fix:

- **The quadratic is per-`anchorParts`-call.** `character` strategy makes one call over the
  whole document; `paragraph` strategy makes one per paragraph, which bounds every doomed
  scan to a few hundred code units. That is why the pathology only ever showed up on
  `character` rows and why paragraph mode looked fine.
- **The quadratic has moved before.** It used to live in `findGrapheme` (`slice` +
  `Intl.Segmenter` per call) and was displaced, not removed, when `indexOf` replaced it. See
  [AGENTS.md](../../../AGENTS.md) — Algorithm map.

## Goals / Non-Goals

**Goals:**

- Remove the quadratic term without changing a single emitted chunk.
- Keep the fix provable — an equivalence with a stated precondition, not a tuned constant.
- Leave a regression that fails if the quadratic reappears anywhere in `anchorParts`, not
  just in the branch it currently occupies.

**Non-Goals:**

- Improving anchoring _accuracy_. The 9 `anchor-drift` residuals the benchmark reports
  against the published library are unchanged and out of scope.
- Supporting mutating tokenizers. That is `tokenizer-length-inflation`.
- Reducing tokenizer time itself. On CJK/paragraph rows the `tiktoken` encode dominates and
  this change cannot touch it.

## Decisions

### 1. Skip Tier 2 on a proof, not a distance bound

`splitPart` is findable by Tier 2 only if it is a substring of `input`. If `splitPart`
contains U+FFFD and `input` does not, it is not a substring, and `indexOf` can only return
`-1`. Testing that costs O(part length) against a scan of O(remaining input).

The precondition — U+FFFD is the _only_ character a splitter may introduce — is not an
assumption invented for this change. It is the supported-tokenizer boundary already stated in
`multibyte-anchoring`: supported splitters preserve bytes except that a decoder substitutes
exactly one U+FFFD per undecodable byte. A splitter that manufactures any other character is
already unsupported and already mis-anchors.

The source is probed once per `anchorParts` call rather than per part, so a source that does
contain U+FFFD simply disables the skip and behavior reverts exactly to today's.

**Evidence.** Instrumented tier counts, 100KB per corpus, `character` strategy:

```
                                                        tier-2 misses
corpus/splitter        parts     t1     t2    t3   drop   fffd / other
────────────────────────────────────────────────────────────────────────
latin      char       102209 102209     0     0      0      0 / 0
latin      whitespace  15355      1  15354    0      0      0 / 0
latin      sentence        1      1      0    0      0      0 / 0
latin      tiktoken    20558  20558      0    0      0      0 / 0
latin+emo  tiktoken    23404  18991   1139    0   3274   3274 / 0
cjk        tiktoken   135426  46330  19312    0  69784  69784 / 0
devanagari tiktoken   102073  25072  12527 13915  50559  64474 / 0
```

137,532 Tier 2 misses across the matrix; **every one contains U+FFFD, none do not**. The
`other` column being uniformly zero is what makes this a complete fix rather than a partial
one on these corpora.

**Alternatives considered** — the other three sketches in
[REWRITE.md](../../../REWRITE.md) — Options to explore:

- _Bound the Tier 2 search window (option 2)._ The same instrumentation records how far Tier
  2 legitimately has to reach: **never more than 4 code units**, with the entire histogram in
  the `1-4` bucket (Tier 3's max reach is 2). So a bound would work on these corpora — and
  that is exactly the problem. None of the corpora contain a splitter that legitimately drops
  a long span (stripped markup, removed stopwords, elided boilerplate), which is a perfectly
  reasonable thing for a caller to write. A bound would silently mis-anchor those, and the
  test suite would not notice. Rejected: it trades a proof for a constant nobody can defend,
  and buys nothing the U+FFFD test does not already buy. The reach data is recorded here so a
  future change that _does_ want a bound starts from measurement.
- _Classify the splitter up front (option 3)._ The U+FFFD test already is the classification,
  evaluated per part at negligible cost and with no probe, no first-use special case, and no
  wrong-guess path. A separate up-front probe would need its own correctness story for
  splitters that are byte-preserving on the first paragraph and not on the tenth.
- _Carry a resync hint across failures (option 4)._ Addresses the symptom (repeating doomed
  scans) rather than the cause (running a search whose answer is known). Strictly more state
  for strictly less certainty.

### 2. Short-circuit `firstAnchorGrapheme` on all-replacement parts

A part consisting only of U+FFFD is unanchorable, and `firstAnchorGrapheme` currently
discovers that by segmenting it and rejecting every segment. At 100KB that is ~50K parts on
Devanagari and ~70K on CJK. Testing `/[^�]/` first is equivalent by construction: if no
non-replacement code unit exists, every segment is a replacement character and the loop
returns `null` regardless. Parts mixing U+FFFD with combining marks still fall through to the
loop, which is the only path that can reject them.

This is a second, independent win and is worth landing with the first: once Decision 1 stops
the scanning, segmentation becomes the next visible cost (Devanagari 156ms → 105ms, CJK 202ms
→ 98ms at 100KB).

### 3. Probe the source eagerly, not lazily

A lazy probe (compute `source.includes(U+FFFD)` only when the first U+FFFD-bearing part
appears) avoids one O(n) scan for splitters that never emit U+FFFD. Measured against the
eager form on `latin char`, `latin whitespace`, `latin tiktoken`, `devanagari char` and
`devanagari whitespace`: **indistinguishable**, within noise on every row. Rejected on
simplicity grounds — it adds a mutable maybe-initialized flag to buy nothing measurable.

### 4. Pin complexity by growth ratio, not wall-clock

An absolute-time assertion is a flaky test on shared CI. The regression instead splits the
same U+FFFD-heavy input at size n and 2n and asserts the ratio stays under a generous
threshold. Today's ratio is ~2.0 fixed and ~3.9 broken, so a threshold around 3 separates
them with a wide margin while tolerating a slow machine. Sizes stay small enough that the
broken case does not hang the suite.

## Risks / Trade-offs

- **[Per-part `includes` on byte-dropping splitters]** Every part that misses Tier 1 now pays
  one short `includes`. Worst case measured is `whitespace` (every part misses Tier 1):
  ~0.3ms per 100KB, against 1.9 _seconds_ saved on the pathological row. → Accepted, and
  recorded here so it is not rediscovered as a mystery.
- **[Source containing literal U+FFFD]** The skip switches off and behavior is exactly
  today's, including today's problems: such a source can already make Tier 2 match a
  decode-produced U+FFFD at the wrong place, over-advance the cursor, and throw. Confirmed
  identical on both sides of the change. → Not introduced here; belongs to
  `tokenizer-length-inflation`, and is recorded in that change's `research.md`.
- **[A future splitter that mutates without emitting U+FFFD]** Would fail Tier 2 with a full
  scan and reach Tier 3 with a wrong anchor — the quadratic returns and the answer is wrong.
  That splitter is already unsupported and already wrong today. → The scaling regression will
  catch the perf half if such a path is ever added; `tokenizer-length-inflation` owns the
  correctness half.
- **[Overlap with `tokenizer-length-inflation`]** Both edit `anchorParts`. This change touches
  the Tier 2 guard and the `firstAnchorGrapheme` entry; that one rewrites the Tier 3 anchor
  step. → Small and disjoint enough to rebase by hand; whichever lands second does so.

## Acceptance criteria

Measured on the corpora and splitters the benchmark already generates, comparing current
`src/` against the change. All four must hold.

### 1. Output is bit-identical

Across the benchmark's full 270-scenario matrix, plus a 324-scenario sweep of
corpus x size x strategy x chunkSize x chunkOverlap x splitter, every chunk's `start`, `end`
and `text` must match the pre-change implementation exactly. Baseline observed: **0
mismatches in 594 scenarios.**

`node test/benchmark.js --diff` must be unchanged in every aggregate:

```
  REAL differences remaining   96
    chunk-count                87
    anchor-drift                9
  new uncovered code units     0 (in 0 scenarios)
  contract violations          old=0 new=0
  [latin] real=5   [cjk] real=36   [devanagari] real=55
```

### 2. Growth is linear

`devanagari`, `character` strategy, `tiktoken` splitter, `chunkSize: 512`, best-of-3:

| size  |  before | after | growth before | growth after |
| ----- | ------: | ----: | ------------: | -----------: |
| 25KB  |   144ms |  36ms |             — |            — |
| 50KB  |   536ms |  70ms |         3.72x |        1.94x |
| 100KB |  2025ms | 157ms |         3.78x |        2.23x |
| 200KB |  7705ms | 332ms |         3.80x |        2.12x |
| 400KB | 30244ms | 668ms |         3.93x |        2.01x |

(The `after` column above is Decision 1 alone; Decision 2 takes 100KB to ~105ms.) Growth per
doubling must stay near 2x, not near 4x.

### 3. Absolute cost on the reported pathology

`devanagari 100KB character cs=512 tiktoken` must drop from ~1976ms to ~105ms with both
decisions applied, and `cjk 100KB character cs=512 tiktoken` from ~338ms to ~98ms.

### 4. No regression on splitters that never emit U+FFFD

100KB, best-of-20 interleaved: `latin char`, `latin whitespace`, `latin tiktoken`,
`devanagari char`, `devanagari whitespace`. Ratio ≤ ~1.3x, with the absolute delta under
0.5ms on every row — the whitespace rows are ~1ms total, so the ratio is the wrong lens and
the absolute number is the one to check.

Plus the standing gate from `openspec/config.yaml`: `npm run check` green (160/160 tests
observed on the prototype), and the gte-small fixtures in
[tokenizer-length-inflation/design.md](../tokenizer-length-inflation/design.md) —
"Acceptance criteria" unaffected, since this change does not touch the Tier 3 anchor step.
