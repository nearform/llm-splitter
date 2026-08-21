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

**Alternatives considered** — the three other sketches.
[core-rewrite/design.md](../2026-08-20-core-rewrite/design.md) — "Performance" summarizes
them in a sentence and points here for the rationale, so this section is their record:

- _Bound the Tier 2 search window._ The same instrumentation records how far Tier
  2 legitimately has to reach: **never more than 4 code units**, with the entire histogram in
  the `1-4` bucket (Tier 3's max reach is 2). So a bound would work on these corpora — and
  that is exactly the problem. None of the corpora contain a splitter that legitimately drops
  a long span (stripped markup, removed stopwords, elided boilerplate), which is a perfectly
  reasonable thing for a caller to write. A bound would silently mis-anchor those, and the
  test suite would not notice. Rejected: it trades a proof for a constant nobody can defend,
  and buys nothing the U+FFFD test does not already buy. The reach data is recorded here so a
  future change that _does_ want a bound starts from measurement.
- _Classify the splitter up front._ The U+FFFD test already is the classification,
  evaluated per part at negligible cost and with no probe, no first-use special case, and no
  wrong-guess path. A separate up-front probe would need its own correctness story for
  splitters that are byte-preserving on the first paragraph and not on the tenth.
- _Carry a resync hint across failures._ Addresses the symptom (repeating doomed
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
the scanning, segmentation becomes the next visible cost. The prototype measured Devanagari
156ms → 105ms and CJK 202ms → 98ms at 100KB; the landed code lands at 113ms and 127ms
respectively (see "Acceptance criteria" 3).

### 3. Probe the source eagerly, not lazily

A lazy probe (compute `source.includes(U+FFFD)` only when the first U+FFFD-bearing part
appears) avoids one O(n) scan for splitters that never emit U+FFFD. Measured against the
eager form on `latin char`, `latin whitespace`, `latin tiktoken`, `devanagari char` and
`devanagari whitespace`: **indistinguishable**, within noise on every row. Rejected on
simplicity grounds — it adds a mutable maybe-initialized flag to buy nothing measurable.

### 4. Pin complexity by growth ratio, not wall-clock

An absolute-time assertion is a flaky test on shared CI. The regression instead splits the
same U+FFFD-heavy input at two sizes and asserts the growth between them stays under a
generous multiple of the size span. Which span and which threshold could not be settled from
the prototype's corpus numbers and had to be measured against the test as written — see the
bullets below.

Timing is the only lever available. The splitter is a caller-supplied function that receives
text and returns parts; it cannot observe which tier anchored it, and `split()` exposes no
counter, so there is no deterministic proxy for "Tier 2 was attempted" to assert on instead.
That makes noise control part of the test design rather than an afterthought:

- **Span: 8x, not 2x — 40,000 code units against 320,000.** A 2x span does not work, and this
  is the one constant that had to move once measured. At suite-affordable sizes the quadratic
  term does not yet dominate the linear per-part work, so the quadratic implementation measures
  only **2.62x** from 40KB to 80KB (2.94x at 80→160KB) — under a threshold of 3, a silent
  pass. Across an 8x span the two shapes separate cleanly.
- **Threshold: 16**, i.e. twice the ideal linear factor of 8. Measured over 5 trials each:
  correct **6.25x – 8.81x**, quadratic **26.0x – 35.0x**. That leaves ~1.8x headroom below the
  threshold and ~1.6x above it, in both directions.
- **Best-of-2 per size**, minimum not mean, so one GC pause cannot fail the build. Runs must
  be equal at both sizes — more runs at the small size alone biases the ratio upward toward a
  false failure.
- **Input shape:** one part per code unit with every fourth replaced by U+FFFD (the shape
  already used by the synthetic splitter cases in
  [test/split.test.js](../../../test/split.test.js)), over CJK source containing no U+FFFD, in
  `character` strategy, `chunkSize: 512`.
- **If the baseline gets too small to divide by** on faster hardware, raise the base size —
  never loosen the threshold. Observed baseline is 2.3–5.9ms, so there is a wide margin before
  that matters.
- **Cost: 116ms in-suite**, taking the suite from 162ms to 295ms, inside the ~150ms budget for
  the regression. A quadratic implementation makes the same test take ~1.5s — visibly slow,
  nowhere near hanging.

Each of the three new tests was confirmed to fail against the code it guards: the growth test
against the pre-fix quadratic (30.4x), the dirty-source test against a variant with the
per-call source probe removed, and the mixed-parts test against a fast path that returns early
whenever a part merely _contains_ U+FFFD (which drops anchorable parts and emits nothing).

## Risks / Trade-offs

- **[Per-part `includes` on byte-dropping splitters]** Every part that misses Tier 1 now pays
  one short `includes`. Worst case measured is `whitespace` (every part misses Tier 1):
  ~0.3ms per 100KB, against 1.9 _seconds_ saved on the pathological row. → Accepted, and
  recorded here so it is not rediscovered as a mystery.
- **[Source containing literal U+FFFD]** The skip switches off and behavior is exactly
  today's, including today's problems: such a source can already make Tier 2 match a
  decode-produced U+FFFD at the wrong place, over-advance the cursor, and throw, and the split
  stays quadratic. Confirmed identical on both sides of the change. → Not introduced here; the
  correctness half belongs to `tokenizer-length-inflation` and is recorded in that change's
  `research.md`. The perf half is stated as an explicit carve-out in the spec delta, so the
  linearity requirement is not falsified by it.
- **[A future splitter that mutates without emitting U+FFFD]** Would fail Tier 2 with a full
  scan and reach Tier 3 with a wrong anchor — the quadratic returns and the answer is wrong.
  That splitter is already unsupported and already wrong today. → Also carved out of the
  linearity requirement, for the same reason. Note the scaling regression will _not_ catch it:
  the regression drives a U+FFFD-emitting splitter, which is the only shape the skip applies
  to. `tokenizer-length-inflation` owns the correctness half; nothing here covers the perf
  half, and that is a deliberate gap rather than an oversight.
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

`node test/benchmark.js --diff` must be unchanged in every aggregate. **Confirmed on the
landed code** — every figure below is what the run printed:

```
  REAL differences remaining   96
    chunk-count                87
    anchor-drift                9
  new uncovered code units     0 (in 0 scenarios)
  contract violations          old=0 new=0
  [latin] real=5   [cjk] real=36   [devanagari] real=55
```

### 2. Growth is linear

`devanagari`, `character` strategy, `tiktoken` splitter, `chunkSize: 512`, best-of-3.
**Confirmed on the landed code**, both decisions applied:

| size  |  before | after | growth before | growth after |
| ----- | ------: | ----: | ------------: | -----------: |
| 25KB  |   154ms |  29ms |             — |            — |
| 50KB  |   531ms |  55ms |         3.45x |        1.87x |
| 100KB |  2013ms | 113ms |         3.79x |        2.08x |
| 200KB |  7625ms | 233ms |         3.79x |        2.05x |
| 400KB | 30440ms | 444ms |         3.99x |        1.91x |

Growth per doubling must stay near 2x, not near 4x. (The prototype's table, taken with
Decision 1 alone, read 36 / 70 / 157 / 332 / 668ms; Decision 2 accounts for the rest.)

### 3. Absolute cost on the reported pathology

`devanagari 100KB character cs=512 tiktoken` must drop from ~1976ms to ~105ms with both
decisions applied, and `cjk 100KB character cs=512 tiktoken` from ~338ms to ~98ms.

**Measured on the landed code, interleaved best-of-6:** devanagari **2013ms → 113ms**
(17.8x) and cjk **342-358ms → 126-127ms** (2.7x). Devanagari matches the prototype;
cjk lands ~28ms above the predicted 98ms, so the cjk claim is 2.7x rather than 3.4x. The
`before` figures reproduce, so this is the prototype's `after` having been optimistic on
that row, not a regression — tiktoken's own encode dominates cjk and this change cannot
touch it.

### 4. No regression on splitters that never emit U+FFFD

100KB, best-of-20 interleaved: `latin char`, `latin whitespace`, `latin tiktoken`,
`devanagari char`, `devanagari whitespace`. Ratio ≤ ~1.3x, with the absolute delta under
0.5ms on every row — the whitespace rows are ~1ms total, so the ratio is the wrong lens and
the absolute number is the one to check. **Confirmed on the landed code:**

| row                   |  before |   after | ratio |   delta |
| --------------------- | ------: | ------: | ----: | ------: |
| latin char            |  2.92ms |  3.20ms | 1.10x | +0.28ms |
| latin whitespace      |  1.09ms |  1.37ms | 1.26x | +0.28ms |
| latin tiktoken        | 17.90ms | 18.08ms | 1.01x | +0.18ms |
| devanagari char       |  4.38ms |  4.84ms | 1.10x | +0.45ms |
| devanagari whitespace |  1.80ms |  1.83ms | 1.02x | +0.03ms |

Plus the standing gate from `openspec/config.yaml`: `npm run check` green (**163/163 on the
landed code**, up from 160 by the three tests in Decision 4), and the gte-small fixtures in
[tokenizer-length-inflation/design.md](../tokenizer-length-inflation/design.md) —
"Acceptance criteria" unaffected, since this change does not touch the Tier 3 anchor step.
