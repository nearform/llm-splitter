## Context

See [proposal.md](./proposal.md) → "Why" for motivation. This section records only the
mechanism and the measurements, because the fix hinges on two distinctions that are not
obvious from reading `anchorParts`.

**Mechanism 1 — the Tier 2 disjunct.** `anchorParts` computes
`sourceHasReplacement = input.includes(U+FFFD)` once per call, then gates tier 2 on:

```js
} else if (sourceHasReplacement || !splitPart.includes(REPLACEMENT_CHAR)) {
  start = input.indexOf(splitPart, cursor);
}
```

The `sourceHasReplacement ||` disjunct exists for a good reason — it is what
`anchor-scan-short-circuit` added so the tier 2 skip stays an _equivalence_ rather than an
approximation. A part containing U+FFFD genuinely can be a verbatim substring of a source
that contains one, so skipping the search would be wrong. But the disjunct is
unconditional, and it therefore also re-enables tier 2 for parts the tokenizer
**manufactured**, which cannot be found verbatim anywhere except by accident.

Traced on the reduced repro, with real `tiktoken` (`text-embedding-ada-002`):

```
input : "漢 hello world � tail"          // literal U+FFFD at index 14
parts : ["�","�"," hello"," world"," �"," tail"]
         ^^^^^^^ the leading 漢 fragments into two bare U+FFFD parts
```

Part 1 is a bare U+FFFD with the cursor at 0. Tier 1 fails. Tier 2 is enabled (the source
has a literal U+FFFD), so `indexOf("�", 0)` returns **14** — the literal one, 13 code
units past where the part actually came from. `end = start + part.length` advances the cursor
to 15, and `" world"` (which lives at index 13) is now behind the cursor and unfindable:

```
Error: Splitter returned a part that could not be located in input (20):
  "漢 hello world � tail"... with part (6): " world"...
```

**The control isolates the cause.** Replacing only the U+FFFD with `"X"` succeeds and
returns `[{ text: " hello world X tail", start: 1, end: 20 }]`. Nothing else about the input
changes.

**It is input-dependent, not universal.** This matters for how the limitation is described:

| input                            | result                                               |
| -------------------------------- | ---------------------------------------------------- |
| `"漢 hello world � tail"`        | **throws**                                           |
| `"👋 wave and a bad byte � end"` | **throws**                                           |
| `"café naïve � rest of doc"`     | succeeds — `tiktoken` emits no bare-U+FFFD part here |
| `"hello world � tail"`           | succeeds — no multi-byte character to fragment       |

So the trigger is a _co-occurrence_: a bare-U+FFFD part must be manufactured, **and** a
literal U+FFFD must sit forward of the cursor, **and** the spurious match must land past a
later real part. A source containing U+FFFD is necessary but not sufficient.

**Mechanism 2 — Tier 3 treats the anchor's position as the part's position.** This is a
second, independent defect, and it turns out to be the one that decides the shape of the fix:

```js
const anchor = firstAnchorGrapheme(splitPart);
if (anchor === null) continue;
start = input.indexOf(anchor, cursor);      // <-- position OF THE ANCHOR
...
const end = Math.min(start + splitPart.length, input.length);
```

`firstAnchorGrapheme` returns the first _positionable_ cluster in the part, which sits at
some offset `k ≥ 0` into it. When `k > 0`, `start` is the anchor's position, not the part's,
so the span is shifted right by `k` and the cursor overshoots by `k`:

```
part  = "�cd"          anchor = "c" at part offset k=1
source= "abcd"          true part span [1,4)
        a  b  c  d
        0  1  2  3
              └── indexOf("c", 0) = 2  →  start=2, end=min(2+3,4)=4     shifted +1
                                          corrected: 2-1 = 1 → [1,4)    correct
```

This contradicts the assumption AGENTS.md calls load-bearing — `end = start + part.length`,
"decoded length equals source span". Tier 3 asserts that a part's span is `part.length` wide
while simultaneously placing its left edge at an interior grapheme. Correcting it is a
one-line change, `indexOf(anchor.segment, cursor + anchor.offset) - anchor.offset`, where
searching from `cursor + offset` is what keeps the corrected `start` at or after the cursor.

## Goals / Non-Goals

**Goals:**

- Anchoring positions do not depend on whether the source happens to contain U+FFFD.
- Preserve the behavior pinned by `test/split.test.js` → "locates a replacement char that is
  genuinely in the source".
- Quantify the residual, so whatever ships is described accurately rather than as "fixed".
- Close the _linearity_ carve-out for a U+FFFD-bearing source if it comes for free. It does
  — see Decision 2.

**Non-Goals:**

- Any change to normalizing/length-inflating tokenizers, which remain
  `tokenizer-length-inflation`'s scope.
- Reopening the distance-bound idea rejected in
  `archive/2026-08-20-anchor-scan-short-circuit/design.md` → "Alternatives".
- Backtracking or lookahead in the anchor walk. Decision 4 shows that is the only thing
  left that could close the last residual, and it is a different change.

## Method

Every number below is measured, not reasoned about. `src/` and `test/` at head were copied
into five scratch trees, one patch applied per tree, nothing applied to the project tree.
Harnesses, all deterministic (seeded `mulberry32`, no `Math.random`):

- **Reduced repro** — the shapes in the table above, plus the two pinned unit-test shapes.
- **Unit suite** — `node --test`, 167 tests at head.
- **Differential fuzz** — corpus `a b . \n 漢 👋 é` **plus literal U+FFFD**, splitters
  `tiktoken`/`char`/`space`, `chunkSize` 1-10, both strategies; identical case sequence
  across trees. Checks `chunk.text === getChunk(...)`, bounds, ordering, adjacency,
  monotonicity, last-`end`. Run at 3,000 strings, 10,000 strings, and 2,000 array inputs.
- **Position oracle** — `tiktoken` is byte-level BPE, so concatenating each token's decoded
  _bytes_ reproduces the input's UTF-8 exactly. Token `i` therefore owns byte range
  `[b_i, b_i+len_i)`, and mapping those byte offsets back to UTF-16 gives each token's
  **true** source span independent of anything `src/split.js` does. Every anchored chunk
  start must land on some true token boundary; one that does not is a provable mis-anchoring.
  This is the only harness here that measures position _correctness_ rather than the absence
  of a throw.
- **Neutrality sweep** — the same text with its literal U+FFFD replaced by `・` (also 3
  UTF-8 bytes, so byte offsets are preserved). Parts may be _omitted_ between the two runs
  (a manufactured part is unanchorable, `・` is not), so the invariant checked is that the
  U+FFFD run's positions are a **subsequence** of the control's: omitted, never moved.
- **Isolated scaling** — a pre-computed parts array, so the timing excludes tokenization and
  measures only the tier walk, over a U+FFFD-bearing source at an 8x size span.

## Decisions

### Decision 1: Correct the Tier 3 anchor offset

**Chosen.** `indexOf(anchor.segment, cursor + anchor.offset) - anchor.offset`, with
`firstAnchorGrapheme` returning `{ segment, offset }` (the offset is already available as
`Intl.Segmenter`'s `index`). Type-checks clean under `strict` + `checkJs`.

On its own this fixes **nothing** in the repro and moves **zero** fuzz positions — with tier
2 still enabled for U+FFFD-bearing parts, few such parts reach tier 3 with `k > 0`. Its
entire value is that it makes Decision 2 correct. Measured alone: 743 → 743 fuzz throws, 0
positions moved, and one unit test changes expectation (Decision 3).

### Decision 2: Skip Tier 2 for every U+FFFD-bearing part

**Chosen.** Drop the `sourceHasReplacement ||` disjunct outright:

```js
} else if (!splitPart.includes(REPLACEMENT_CHAR)) {
```

This is the simplest possible patch, and it was **rejected in an earlier round of this
design** because it failed 2 of 167 tests. That rejection was correct on the evidence
available and wrong in its diagnosis. Both failures were the Tier 3 off-by-`k`, not the
skip:

```
"locates a replacement char that is genuinely in the source"   input "a �b", whitespace splitter
  head                       [["a ", 0, 2], ["�b", 2, 4]]     ✓  (tier 2 exact match)
  skip only                  [["a �", 0, 3], ["b",  3, 4]]     ✗  anchored on "b" at 3, k=1 lost
  skip + Decision 1          [["a ", 0, 2], ["�b", 2, 4]]     ✓  2 = indexOf("b", 1+1) - 1
```

With Decision 1 in place, both failures disappear and the skip becomes shippable. The
contract fuzz — the second failure — passes too.

**Why the skip is the right primitive.** A part containing U+FFFD carries a code unit the
splitter invented. Searching the source for it verbatim asks "does this invented byte
sequence happen to occur downstream", and a hit answers a question nobody asked. Tier 3
already knows how to position such a part from the real graphemes inside it; Decision 1 is
what makes it do so accurately. The skip simply stops consulting the unreliable oracle first.

**Measured, 3,000-case differential fuzz** (identical cases across trees):

| variant                   | succeeded | threw | OK→THROW | invariant violations |
| ------------------------- | --------- | ----- | -------- | -------------------- |
| head                      | 2,257     | 743   | —        | 0                    |
| skip only (no Decision 1) | 2,979     | 21    | **21**   | 0                    |
| Tier 2 bare/mixed gate    | 2,750     | 250   | 0        | 0                    |
| Decision 1 only           | 2,257     | 743   | 0        | 0                    |
| **Decision 1 + 2**        | **3,000** | **0** | **0**    | **0**                |

The `skip only` row is the earlier rejection, quantified: 21 real regressions, all `space`
splitter. Decision 1 removes all 21.

At 10,000 strings: head 2,487 throws, bare/mixed gate 768, Decision 1+2 **0**, with 0
OK→THROW and 0 invariant violations. At 2,000 array inputs: head 472, bare/mixed gate 128,
Decision 1+2 **0**.

**Decision 1 + 2 strictly dominates the bare/mixed gate.** Taking the gate as the baseline
and Decision 1+2 as the variant, over 3,000 cases: `2,750 OK→OK` with **0 positions moved**,
`250 THROW→OK`, `0 OK→THROW`. Wherever the gate produces an answer, Decision 1+2 produces
byte-identical positions; it additionally rescues every case the gate throws on. Same result
on the array sweep.

**It also closes the linearity carve-out**, which the bare/mixed gate explicitly could not
(mixed parts stay on tier 2 there). Isolated anchoring cost over a U+FFFD-bearing source,
8x size span:

| variant                | 5k    | 10k    | 20k     | 40k     | cost growth | verdict   |
| ---------------------- | ----- | ------ | ------- | ------- | ----------- | --------- |
| head                   | 9.2ms | 28.9ms | 100.2ms | 374.8ms | **40.8x**   | quadratic |
| Tier 2 bare/mixed gate | 8.8ms | 29.0ms | 100.2ms | 370.9ms | **42.0x**   | quadratic |
| Decision 1 + 2         | 3.1ms | 8.2ms  | 16.5ms  | 33.0ms  | **10.7x**   | linear    |

So the shipped spec's "Source containing U+FFFD keeps the unbounded search (known
limitation)" scenario is not a permanent fact about the problem — it is a consequence of the
disjunct, and it goes away with it. That is a spec _deletion_, not a widening.

The in-suite "grows linearly with input size" regression stays green.

### Decision 3: Accept the one changed unit expectation

Decision 1 changes exactly one pinned expectation, in
`test/split.test.js` → "drops unanchorable parts without dropping mixed ones":

```
input "abcd", splitter () => ["���", "́�", "�cd"]
  head        [["cd",  2, 4]]
  Decision 1  [["bcd", 1, 4]]
```

`[1,4)` is the correct value. The part `"�cd"` is 3 code units and the library's core
assumption is that a part's span equals its length, so its left edge belongs at `4-3 = 1`.
The old `2` was the anchor `"c"`'s position standing in for the part's, which is the defect
Decision 1 removes. Nothing else in the suite moves: 166/167, with
"locates a replacement char that is genuinely in the source", the contract fuzz, and the
scaling regression all green.

### Decision 4: The last residual is Tier 1, and no local rule can close it

Under Decision 1+2 the fuzz throws zero times, but the position oracle still finds a small
number of wrong positions. **They are not a tier 2 or tier 3 problem.** Every one of them is
`startsWith` at the cursor matching a manufactured bare U+FFFD part against a **literal**
U+FFFD standing exactly at the cursor:

```
input : "\n. a� 漢��é"                    literal U+FFFD at 4, 7, 8
parts : ["\n",".", " a", "�", " �", "�", "�", "��", "é"]
                                     ^^^  ^^^  manufactured from 漢's tail bytes
true token starts : {0,1,2,4,5,7,9}       (from byte arithmetic)
reported starts   : {0,1,2,4,5,7,8,9}
                              ^ token 6 (bare, manufactured) matched the literal U+FFFD at 8
```

Tested over 8,000 cases: **33 wrong positions, 33 of which land on a literal U+FFFD in the
source, 0 counterexamples.** The bare/mixed gate has the same defect at the same rate
(22 of 22). Tier 1 fires before any gate, and at the cursor a manufactured bare U+FFFD and a
literal one are byte-identical — there is nothing to test.

**It is benign, and materially different from what it replaced.** The matched part is one
code unit and the literal U+FFFD it matched is one code unit, so the cursor advances by
exactly the right amount. There is no overshoot and therefore no drift: every _other_ part
in an affected input still anchors correctly. The whole effect is one extra chunk boundary,
attributing one source U+FFFD to the wrong token. Coverage is unaffected.

**And the general form is undecidable locally.** The Open Question in the earlier round
asked whether validating a tier 2 match against the part's non-U+FFFD skeleton could close
the mixed-part residual. It cannot, twice over. First it is vacuous: `indexOf` succeeding
already guarantees `input[m+i] === part[i]` for every `i`, so a skeleton comparison at the
matched offset can never reject anything. Second, and more fundamentally, the spurious case
and the legitimate case are **indistinguishable from the part, the source, and the cursor**:

```
                    part      cursor  tier2  tier3(corrected)  truth   verdict
residual (spurious) " �"      2       12     2                 2       tier2 wrong
decoy (legitimate)  "a�b"     1       4      2                 4       tier2 RIGHT
```

Identical signatures — `tier2 > tier3corrected` in both — opposite truths. Any rule choosing
between _those two candidate positions_ on those three inputs must be wrong on one of them.

**Corrected after review: that conclusion was stated too broadly.** It rules out picking
between tier 2's answer and tier 3's, which is what the table shows. It does _not_ rule out
every local rule, because a tier 3 candidate has matched only one grapheme — so verifying the
part's remaining non-U+FFFD code units against the source at that candidate is not vacuous
there, unlike the same check on a verbatim tier 2 hit. Measured: adding a skeleton check to
the tier 3 candidate (advance the search while the part's non-U+FFFD units do not align)
fixes the paragraph-splitter case, both decoy cases, and cuts the multi-character-dropping
regression from 1,663 wrong to 678 of 16,842 — while leaving every gate in "Reproducing the
measurements" unchanged: 0 throws on all three fuzz sweeps, 0 `OK→THROW`, the same 142/461/107
positions moved, the same oracle residual, 171/171 suite, and still linear at 7.2x for an 8x
input span.

It is not a complete fix (678 against 489 at the merge base) and it was not adopted here, so
it is recorded as the concrete next step rather than as shipped. What genuinely needs
backtracking is closing the remaining gap and the Tier 1 residual: knowing whether the _rest_
of the parts still anchor under each choice.

### Decision 5: Ship it, and state the two residuals

Decision 1+2 eliminates every throw in 15,000 fuzz cases and every throw in the reduced
repro, moves no position that the previously-chosen gate got right, and closes the linearity
carve-out. Two residuals remain and both are stated rather than hidden: the Tier 1 artifact
above, and the decoy class in Risks. The spec delta is narrowed to match — see
[specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md).

**Superseded:** the Tier 2 bare/mixed gate, which an earlier round of this design chose. It
is dominated on every measurement taken — same positions where it succeeds, 768 residual
throws at 10k cases against 0, quadratic where Decision 1+2 is linear, and a more
complicated predicate. Its identifiability argument ("a bare part carries no locating
information, a mixed part does") is still sound as far as it goes; Decision 4 is why it does
not go far enough — one real code unit beside a manufactured U+FFFD is weak evidence, and
the gate has no way to say how weak.

## Acceptance criteria

Following the convention `tokenizer-length-inflation` set, the regression code lives here
until the fix lands, so `test/split.test.js` stays unconditional and green.

**1. Real-tokenizer regression.** Goes in `test/split.test.js` alongside the existing
`tiktoken` cases. Fails at head, passes under Decision 1+2:

```js
it("does not anchor a manufactured replacement char on a literal one", () => {
  // tiktoken fragments the leading 漢 into two bare U+FFFD parts. The source
  // also holds a literal U+FFFD, which used to re-enable the verbatim search,
  // so the manufactured part matched that literal one 13 code units
  // downstream, stranded the cursor past " world", and threw.
  const tokenizer = tiktoken.encoding_for_model("text-embedding-ada-002");
  const td = new TextDecoder();
  const tokenSplitter = (text) =>
    Array.from(tokenizer.encode(text)).map((token) =>
      td.decode(tokenizer.decode([token])),
    );

  try {
    const withLiteral = split("漢 hello world � tail", {
      chunkSize: 100,
      splitter: tokenSplitter,
    });
    // The same input with the replacement char swapped for an ordinary
    // character is the control: positions must not differ.
    const control = split("漢 hello world X tail", {
      chunkSize: 100,
      splitter: tokenSplitter,
    });

    assert.deepStrictEqual(
      withLiteral.map(({ start, end }) => [start, end]),
      control.map(({ start, end }) => [start, end]),
    );
    assert.deepStrictEqual(withLiteral, [
      { text: " hello world � tail", start: 1, end: 20 },
    ]);
  } finally {
    tokenizer.free();
  }
});
```

**2. Splitter-only synthetic**, reproducing the shape with no native dependency, so the
regression still bites if the `tiktoken` devDependency is ever dropped:

```js
it("drops a bare replacement part rather than matching a literal one", () => {
  // Mimics a tokenizer fragmenting a multi-byte char into bare U+FFFD parts:
  // "漢" -> two unanchorable parts, then the rest verbatim.
  /** @param {string} text */
  const fragmentingSplitter = (text) =>
    [...text].flatMap((ch) => (ch === "漢" ? ["�", "�"] : [ch]));

  const chunks = split("漢ab�cd", {
    chunkSize: 100,
    splitter: fragmentingSplitter,
  });

  assert.deepStrictEqual(chunks, [{ text: "ab�cd", start: 1, end: 6 }]);
});
```

**3. Tier 3 offset regression.** Pins Decision 1 directly, so the `- anchor.offset` cannot
be dropped as redundant. The mixed part `"�b"` must anchor at its own left edge, not at
its `"b"`:

```js
it("anchors a mixed part at its left edge, not at its anchor grapheme", () => {
  // "�b" is 2 code units, so its span is [2,4) — the replacement char stands
  // in for the source's own. Anchoring on the "b" would report [3,5)->[3,4)
  // and advance the cursor one unit too far.
  const chunks = split("a �b", { chunkSize: 1, splitter: whitespaceSplitter });

  assert.deepStrictEqual(
    chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
    [
      ["a ", 0, 2],
      ["�b", 2, 4],
    ],
  );
});
```

**4. Updated expectation** in "drops unanchorable parts without dropping mixed ones":
`[["cd", 2, 4]]` becomes `[["bcd", 1, 4]]`, per Decision 3. Worth a comment saying why 1 is
the correct left edge, since the change looks like a regression otherwise.

**5. Linearity over a U+FFFD-bearing source.** The existing "grows linearly with input size"
regression uses a source with no U+FFFD, which is the case head already guarantees. Decision
2 extends the guarantee to a source that has one, and nothing pins that. Add a sibling case
with a literal U+FFFD in the source; head measures 40.8x for an 8x span, Decision 1+2
measures 10.7x. Keep AGENTS.md's rule that the threshold is not to be weakened for a slow
machine — raise the base size instead.

**6. Differential fuzz gate.** Kept as a one-off during the spike rather than added to the
suite (it needs both a patched and an unpatched tree). Bar to clear before landing: **zero
`OK→THROW` transitions** and **zero invariant violations** across the 3,000-string,
10,000-string, and 2,000-array sweeps. Achieved: 0 throws of any kind on all three.

## Reproducing the measurements

Every gate in `tasks.md` § 3 is checked by one script. It is recorded here rather than added
to `test/split.js` because it needs **two trees** — an unpatched and a patched copy of `src/`
— which the suite cannot express. Set up and run:

Save the script below as `verify.mjs` **in the repo root**. It has to live inside the repo:
it imports `tiktoken` by bare specifier, and Node resolves that from the script's own
directory, not from the working directory. The two trees it compares can be anywhere, since
they are imported by absolute path.

```sh
V=$(mktemp -d)
mkdir -p "$V/base/src" "$V/patched/src"
# Baseline: src/ as committed, before the fix.
for f in $(git ls-tree --name-only HEAD src/); do
  git show "HEAD:$f" > "$V/base/src/$(basename "$f")"
done
cp src/*.js "$V/patched/src/"   # patched: the working tree
node verify.mjs "$V/base" "$V/patched"
```

If the baseline is already committed, point it at the pre-fix commit instead of `HEAD`.

It exits non-zero when any gate fails, so it can be dropped into CI as-is. The gates are
adversarially checked: run it against the fix's own rejected alternatives and it fails —
dropping the Tier 2 disjunct _without_ Decision 1 trips "no OK→THROW" (21 / 73 / 8 across the
three sweeps), and the superseded bare/mixed gate trips both "patched throws zero times" and
"patched is linear" (39.9x). A harness that passes everything proves nothing; this one does
not.

Expected output against Decision 1 + 2, reproduced verbatim on a clean run:

```
fuzz 3,000 strings: baseline threw 743, patched threw 0, THROW→OK 743, positions moved 142
fuzz 10,000 strings: baseline threw 2487, patched threw 0, THROW→OK 2487, positions moved 461
fuzz 2,000 arrays: baseline threw 472, patched threw 0, THROW→OK 472, positions moved 107
oracle 2,000 cases: baseline threw 1534/off 4, patched threw 0/off 7
scaling (U+FFFD-bearing source, 8x span): baseline 41.9x, patched 7.7x
ALL GATES PASS
```

The two timing figures vary a few points run to run; the throw counts, moved counts, and
oracle counts are exact. `off 7` against `off 4` is not a regression — the oracle's
`ok→off` gate is what catches regressions, and those 7 are the Tier 1 residual (Decision 4),
which the script verifies by checking each one lands on a literal U+FFFD.

```js
// Differential verification for literal-replacement-char-anchoring.
// Usage: node verify.mjs <baselineTree> <patchedTree>
// Each tree is a directory holding a copy of src/ (e.g. an unpatched and a
// patched checkout). Needs `tiktoken` resolvable from the CWD.
import { performance } from "node:perf_hooks";
import tiktoken from "tiktoken";

const [BASE, PATCHED] = process.argv.slice(2);
if (!BASE || !PATCHED) throw new Error("usage: verify.mjs <base> <patched>");

const load = async (dir) => ({
  split: (await import(`${dir}/src/split.js`)).split,
  getChunk: (await import(`${dir}/src/get-chunk.js`)).getChunk,
});

const tk = tiktoken.encoding_for_model("text-embedding-ada-002");
const td = new TextDecoder();
const enc = new TextEncoder();
const tokenSplitter = (text) =>
  Array.from(tk.encode(text)).map((t) =>
    td.decode(tk.decode(new Uint32Array([t]))),
  );

// Deterministic: mulberry32, never Math.random, so both trees see one corpus.
const rngFor = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// The last entry is the point: a source that already holds U+FFFD.
const CORPUS = ["a", "b", ".", "\n", "漢", "👋", "é", "�"];
const SPLITTERS = [
  { name: "tiktoken", fn: tokenSplitter },
  { name: "char", fn: (t) => t.split("") },
  { name: "space", fn: (t) => t.split(" ") },
];

const caseFor = (seed, i, useArrays) => {
  const rng = rngFor(seed + i * 7919);
  let text = "";
  for (let t = 0, n = 5 + Math.floor(rng() * 36); t < n; t++) {
    text += CORPUS[Math.floor(rng() * CORPUS.length)];
    if (rng() < 0.25) text += " ";
  }
  const splitter = SPLITTERS[Math.floor(rng() * SPLITTERS.length)];
  const chunkSize = 1 + Math.floor(rng() * 10);
  const chunkStrategy = rng() < 0.5 ? "character" : "paragraph";
  let input = text;
  if (useArrays && rng() < 0.5) {
    const cuts = [];
    for (let c = 0, n = 1 + Math.floor(rng() * 3); c < n; c++) {
      cuts.push(Math.floor(rng() * text.length));
    }
    cuts.sort((x, y) => x - y);
    input = [];
    let prev = 0;
    for (const cut of [...cuts, text.length]) {
      input.push(text.slice(prev, cut));
      prev = cut;
    }
  }
  return { input, splitter, chunkSize, chunkStrategy };
};

/** Coverage-contract fuzz: throws, plus every invariant split() promises. */
const fuzz = ({ split, getChunk }, cases, seed, useArrays) => {
  const out = [];
  for (let i = 0; i < cases; i++) {
    const { input, splitter, chunkSize, chunkStrategy } = caseFor(
      seed,
      i,
      useArrays,
    );
    let chunks;
    try {
      chunks = split(input, {
        chunkSize,
        splitter: splitter.fn,
        chunkStrategy,
      });
    } catch {
      out.push({ i, splitter: splitter.name, ok: false });
      continue;
    }
    const items = Array.isArray(input) ? input : [input];
    const total = items.reduce((s, x) => s + x.length, 0);
    const bad = [];
    for (const c of chunks) {
      const want = getChunk(input, c.start, c.end);
      const same = Array.isArray(want)
        ? JSON.stringify(want) === JSON.stringify(c.text)
        : want === c.text;
      if (!same) bad.push(`text@${c.start}`);
      if (!(c.start >= 0 && c.end <= total && c.start <= c.end)) {
        bad.push(`bounds@${c.start}`);
      }
    }
    if (chunks.length) {
      if (chunks.at(-1).end !== total) bad.push("lastEnd");
      for (let k = 0; k + 1 < chunks.length; k++) {
        if (chunks[k].end < chunks[k + 1].start) bad.push(`gap@${k}`);
        if (chunks[k].start > chunks[k + 1].start) bad.push(`monotonic@${k}`);
      }
    }
    out.push({
      i,
      splitter: splitter.name,
      ok: true,
      n: chunks.length,
      sig: chunks.map((c) => `${c.start}-${c.end}`).join(","),
      bad,
    });
  }
  return out;
};

/**
 * Ground-truth token starts, from byte arithmetic rather than from split().
 * tiktoken is byte-level BPE, so concatenating each token's decoded bytes
 * reproduces the input's UTF-8 exactly; a byte offset that falls on a
 * character boundary maps back to a true UTF-16 start.
 */
const trueStarts = (text) => {
  const u2b = [0];
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    const width = cp > 0xffff ? 2 : 1;
    const n = enc.encode(String.fromCodePoint(cp)).length;
    for (let k = 0; k < width; k++) {
      u2b[i + k + 1] = bytes + (k === width - 1 ? n : 0);
    }
    bytes += n;
    i += width;
  }
  const b2u = new Map();
  for (let i = 0; i <= text.length; i++) {
    if (!b2u.has(u2b[i])) b2u.set(u2b[i], i);
  }
  const starts = new Set([0]);
  let b = 0;
  for (const t of Array.from(tk.encode(text))) {
    if (b2u.has(b)) starts.add(b2u.get(b));
    b += tk.decode(new Uint32Array([t])).length;
  }
  return starts;
};

/** Position correctness, not just absence of a throw. */
const oracle = ({ split }, cases, seed) => {
  const out = [];
  for (let i = 0; i < cases; i++) {
    const { input } = caseFor(seed, i, false);
    let chunks;
    try {
      chunks = split(input, {
        chunkSize: 1,
        splitter: tokenSplitter,
        chunkStrategy: "character",
      });
    } catch {
      out.push({ i, status: "throw" });
      continue;
    }
    const truth = trueStarts(input);
    const bad = chunks.map((c) => c.start).filter((s) => !truth.has(s));
    out.push({
      i,
      status: bad.length ? "off" : "ok",
      bad,
      // The known Tier 1 residual: a manufactured bare U+FFFD matched a
      // literal one standing at the cursor. Anything else is a new defect.
      allOnLiteral: bad.every((s) => input[s] === "�"),
    });
  }
  return out;
};

/** Anchoring cost only — parts are precomputed, so tokenization is excluded. */
const scaling = ({ split }) => {
  const rows = [];
  for (const n of [5000, 10000, 20000, 40000]) {
    const body = "これは日本語のテキストです"
      .repeat(Math.ceil(n / 13))
      .slice(0, n);
    const input = "� " + body;
    const chars = [...body];
    const parts = [];
    for (let i = 0; i + 1 < chars.length; i += 2) parts.push(chars[i] + "�");
    const splitter = () => parts;
    split(input, { chunkSize: 8, splitter });
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      split(input, { chunkSize: 8, splitter });
      best = Math.min(best, performance.now() - t0);
    }
    rows.push({ len: input.length, ms: best });
  }
  return {
    span: rows.at(-1).len / rows[0].len,
    cost: rows.at(-1).ms / rows[0].ms,
    rows,
  };
};

// ---------------------------------------------------------------- report

const base = await load(BASE);
const patched = await load(PATCHED);
let failures = 0;
const gate = (label, pass, detail) => {
  if (!pass) failures++;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
};

for (const [label, cases, seed, arrays] of [
  ["3,000 strings", 3000, 20260821, false],
  ["10,000 strings", 10000, 99001, false],
  ["2,000 arrays", 2000, 777001, true],
]) {
  const b = fuzz(base, cases, seed, arrays);
  const p = fuzz(patched, cases, seed, arrays);
  let okThrow = 0;
  let throwOk = 0;
  let moved = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i].ok && !p[i].ok) okThrow++;
    else if (!b[i].ok && p[i].ok) throwOk++;
    else if (b[i].ok && p[i].ok && b[i].sig !== p[i].sig) moved++;
  }
  const viol = p.filter((r) => r.ok && r.bad.length).length;
  console.log(
    `\nfuzz ${label}: baseline threw ${b.filter((r) => !r.ok).length}, ` +
      `patched threw ${p.filter((r) => !r.ok).length}, ` +
      `THROW→OK ${throwOk}, positions moved ${moved}`,
  );
  gate("no OK→THROW", okThrow === 0, `${okThrow}`);
  gate("no invariant violations", viol === 0, `${viol}`);
  gate(
    "patched throws zero times",
    p.every((r) => r.ok),
  );
}

const ob = oracle(base, 2000, 4242);
const op = oracle(patched, 2000, 4242);
let okOff = 0;
for (let i = 0; i < ob.length; i++) {
  if (ob[i].status === "ok" && op[i].status === "off") okOff++;
}
const offP = op.filter((r) => r.status === "off");
console.log(
  `\noracle 2,000 cases: baseline threw ${ob.filter((r) => r.status === "throw").length}` +
    `/off ${ob.filter((r) => r.status === "off").length}, ` +
    `patched threw ${op.filter((r) => r.status === "throw").length}/off ${offP.length}`,
);
gate("no ok→off regressions", okOff === 0, `${okOff}`);
gate(
  "every residual is the Tier 1 signature",
  offP.every((r) => r.allOnLiteral),
  `${offP.filter((r) => !r.allOnLiteral).length} unexplained`,
);

const sb = scaling(base);
const sp = scaling(patched);
console.log(
  `\nscaling (U+FFFD-bearing source, ${sb.span.toFixed(0)}x span): ` +
    `baseline ${sb.cost.toFixed(1)}x, patched ${sp.cost.toFixed(1)}x`,
);
gate("patched is linear", sp.cost < sp.span * 2, `${sp.cost.toFixed(1)}x`);

tk.free();
console.log(
  `\n${failures === 0 ? "ALL GATES PASS" : `${failures} GATE(S) FAILED`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
```

## Risks / Trade-offs

- **[A genuinely-verbatim mixed part can now be mis-anchored — the decoy class]** → This is
  the real cost of Decision 2, and it is constructible even though no fuzz case hit it. When
  a mixed part _is_ verbatim in the source, tier 2 used to find it exactly; tier 3 now walks
  to its first anchor grapheme, which can match a decoy occurrence between the cursor and
  the part's true position:

  ```
  source "a a a�b", splitter () => ["a", "a�b"]     true start of part 2 = 4
    head / bare-mixed gate    4  ✓   (tier 2 exact)
    Decision 1 + 2            2  ✗   (decoy "a" at index 2)
  ```

  The shape needs a splitter that **drops multi-character content**, plus a repeated anchor
  grapheme in the dropped gap, plus a U+FFFD-bearing part.

  **Corrected after review — the original claim here was wrong.** It read "None of the
  documented splitters qualify", reasoning from `char` and `tiktoken` (which drop nothing) and
  `text.split(/\s+/)` (which drops a single whitespace run). That reasoning does not
  generalize, and the requirement it appealed to names _sentence/line regex splitters_ as
  supported. `text.split(/[.!?]+/)` — the README's own worked example — drops `"..."`, and
  `text.split("\n\n")` drops the same delimiter the library uses for
  `chunkStrategy: "paragraph"`. Both qualify. Measured over 16,842 randomized
  multi-character-dropping cases whose source holds a literal U+FFFD: **1,663 parts anchored
  away from their true offset, against 489 at the merge base** — a real regression inside the
  branch, though published 0.2.0 mis-anchors the same inputs, so nothing users hold regresses.

  Measured two independent ways, both clean. Against `tiktoken`'s byte-derived truth the
  oracle shows **0 `ok→off`** transitions — no case that was correctly positioned becomes
  incorrectly positioned. And for the `space` splitter, whose parts are verbatim substrings
  so exact-offset arithmetic gives ground truth directly, all **220** cases whose positions
  moved under `character` strategy have _both_ sides fully on truth: the two runs differ over
  which parts are dropped, never over where a surviving part lands. Note that truth function
  is only valid for `character` strategy — in `paragraph` mode positions are group-relative,
  and applying whole-text arithmetic there manufactures phantom failures.

  It is a silent position error, not a throw, which is the failure mode README:372 warns is
  worse — so it gets stated in the spec, not left implicit.

- **[The Tier 1 residual]** → Decision 4. Benign (one extra chunk boundary, no drift, no
  throw, coverage intact), unavoidable locally, and present in the superseded approach at
  the same rate. Stated in the spec as a narrow exception to position-neutrality.

- **[461 fuzz cases change position while succeeding on both sides, 226 with a different
  chunk count]** (10,000-case sweep) → These are baseline _silent_ mis-anchorings being
  corrected. Position-neutrality against a byte-width-preserving control, over the 3,562
  cases containing a literal U+FFFD:

  | variant                | positions a subsequence of control | moved  | threw |
  | ---------------------- | ---------------------------------- | ------ | ----- |
  | head                   | 429                                | 11     | 3,122 |
  | Tier 2 bare/mixed gate | 2,555                              | 9      | 998   |
  | **Decision 1 + 2**     | **3,550**                          | **12** | **0** |

  The oracle agrees: taking the bare/mixed gate as baseline, Decision 1+2 is `ok→ok 1,513`,
  `throw→ok 480`, `off→off 5` (identical wrong starts), `throw→off 2`, and **`ok→off` 0**.
  Against head it is `off→ok 3` — it repairs mis-anchorings head had. Still: positions and
  chunk counts change for affected inputs, so this needs a changeset with the "regenerate
  persisted embeddings / citation offsets" note the `0.3.0` rewrite carries. Not a patch.

- **[A source's genuine U+FFFD is less often anchored as a part]** → Its code units stay
  covered, absorbed forward into the previous chunk per `chunk-coverage`, so nothing is lost
  positionally. `chunkSize` counts parts, so an affected chunk may hold marginally more
  source. Same class of undercount already documented at README:389.

- **[Not verified against `gte-small`]** → AGENTS.md requires tokenizer-affecting changes to
  run against the real gte-small fixtures as well as the multibyte ones.
  `@huggingface/transformers` is not a devDependency of this repo and was not installed for
  this spike, so that leg is **unrun**. It is a genuine gap, not a pass. Those tokenizers are
  already a documented limitation for a different reason (length inflation), and this change
  edits the same tier 3 region `tokenizer-length-inflation` will, so the check belongs to
  whichever lands second.

- **[Overlap with `tokenizer-length-inflation`]** → Both edit tier 2/tier 3 of `anchorParts`,
  and that change's `research.md:36-43` lists this shape as "a fourth instance of the same
  root cause". Note that its Decision 2 replaces tier 3 **only when `sourceNormalize` is
  set**, so the default-path off-by-`k` fixed here survives it untouched — the two changes
  are more independent than that risk note implies. Whichever lands second rebases.

- **[The fix is two small edits, so it is easy to half-revert]** → Decision 1 alone looks
  like a no-op (it moves zero fuzz positions) and Decision 2 alone regresses 21 cases.
  Reverting either one separately is worse than reverting both. This needs a comment at the
  tier 3 call site saying the offset subtraction is what makes the tier 2 skip safe, and a
  line in AGENTS.md's algorithm map.

## Open Questions

- Would a backtracking anchor walk — accept a candidate position only if the remaining parts
  still anchor from it — close both the decoy class and the Tier 1 residual? Decision 4
  establishes that nothing local can, so this is the only remaining direction. Cost is the
  open part: worst-case it reintroduces a per-part factor, which is exactly what
  `anchor-scan-short-circuit` spent a change removing. Deferrable — it does not change
  Decision 1, Decision 2, the task breakdown, or the delta as written.
