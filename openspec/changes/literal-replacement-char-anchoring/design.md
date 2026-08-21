## Context

See [proposal.md](./proposal.md) → "Why" for motivation. This section records only the
mechanism and the measurements, because the fix hinges on a distinction that is not obvious
from reading `anchorParts`.

**The mechanism.** `anchorParts` computes `sourceHasReplacement = input.includes(U+FFFD)`
once per call, then gates tier 2 on:

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
                ^^^^^^^^^^^^^^^^^^^ the leading 漢 fragments into two bare U+FFFD parts
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

**The tier 2 skip is load-bearing for correctness, not only for speed.** The control row
above is the same code path with the skip active. `anchor-scan-short-circuit`'s spec delta
frames the skip purely as a linearity optimization and carves out the U+FFFD-bearing source
as a _performance_ exception ("no linearity guarantee applies"). That framing understates it:
with the skip active the manufactured part is correctly dropped, and with it inactive the
same part mis-anchors. The spec delta in this change fixes that framing.

## Goals / Non-Goals

**Goals:**

- Anchoring positions do not depend on whether the source happens to contain U+FFFD.
- Preserve the behavior pinned by `test/split.test.js` → "locates a replacement char that is
  genuinely in the source". See Decision 2 — this turns out to be free.
- Quantify the residual, so whatever ships is described accurately rather than as "fixed".

**Non-Goals:**

- Closing the _linearity_ carve-out for a U+FFFD-bearing source. Mixed parts still take an
  unbounded tier 2 search under the recommended approach; the perf half stays carved out.
- Any change to normalizing/length-inflating tokenizers, which remain
  `tokenizer-length-inflation`'s scope.
- Reopening the distance-bound idea rejected in
  `archive/2026-08-20-anchor-scan-short-circuit/design.md` → "Alternatives".

## Decisions

All three candidates below were **measured**, not reasoned about. Method: a copy of `src/`
and `test/` at head into a scratch tree, one patch applied, then (a) the reduced repro, (b)
the full `node --test` suite, and (c) a deterministic differential fuzz — 3,000 cases over a
corpus of `a b . \n 漢 👋 é` **plus literal U+FFFD**, across the `tiktoken`, `char`, and
`space` splitters, `chunkSize` 1-10, both strategies, same seed on both sides — checking
`chunk.text === getChunk(...)`, bounds, adjacency, monotonicity, and last-`end`. Nothing was
applied to the project tree.

### Decision 1: Gate tier 2 on the part being _entirely_ U+FFFD, not on merely containing one

**Chosen.** Attempt tier 2 when the part has no U+FFFD at all (unchanged), or when the source
has one **and** the part is not made only of replacement characters:

```js
} else if (
  !splitPart.includes(REPLACEMENT_CHAR) ||
  (sourceHasReplacement && !ONLY_REPLACEMENT_CHARS.test(splitPart))
) {
```

`ONLY_REPLACEMENT_CHARS` already exists (it is `firstAnchorGrapheme`'s fast path), so this
adds no new predicate.

The rationale is an _identifiability_ argument. A part that is entirely U+FFFD carries no
information locating it: it is byte-for-byte identical whether the splitter manufactured it
or passed through a literal one, so tier 2's match on it is a coin flip. A part that mixes
U+FFFD with real text does carry locating information, and tier 2's match on it is meaningful.
Splitting on "bare vs mixed" therefore separates the untrustworthy searches from the
trustworthy ones exactly.

Dropping a bare part costs nothing in coverage: `chunk-coverage` absorbs unclaimed code units
forward into the previous chunk, so the source's real U+FFFD is still inside a chunk's
`[start, end)` — it just is not the anchor for a part.

**Measured:**

|                            | baseline (head) | Decision 1                               |
| -------------------------- | --------------- | ---------------------------------------- |
| reduced repro (5 cases)    | 2 throw         | **0 throw**, positions equal the control |
| `node --test`              | 167/167         | **167/167**                              |
| fuzz: succeeded            | 2,180           | **2,881**                                |
| fuzz: threw                | 820             | **119**                                  |
| fuzz: invariant violations | 0               | **0**                                    |

Transition matrix over the 3,000 shared cases: `2180 OK→OK`, `701 THROW→OK`,
`119 THROW→THROW`, and **`0 OK→THROW`** — no case regressed. 69 cases succeed on both sides
with a different chunk count; those are baseline silent mis-anchorings being corrected (see
Risks).

**Alternative considered — drop the `sourceHasReplacement ||` disjunct entirely** (always skip
tier 2 for any U+FFFD-bearing part). Simplest possible patch, and it would additionally close
the linearity carve-out. **Rejected on measurement:** it fixes the repro but fails 2 of 167
tests — "locates a replacement char that is genuinely in the source", and the contract fuzz,
which throws on the `space` splitter over `"…ad ad\n��"` where a legitimately mixed
part needs its verbatim search. Over-broad: it discards the trustworthy searches along with
the untrustworthy ones.

### Decision 2: Do not renegotiate the pinned "genuinely in the source" scenario

The proposal flagged as a risk that any fix might have to renegotiate
`test/split.test.js:1407`. On inspection it does not, and the reason is worth recording
because it is what makes Decision 1 cheap. That test splits `"a �b"` with a whitespace
splitter, so the part under test is `"�b"` — **mixed**, not bare. Decision 1 leaves
every mixed part on tier 2, so the scenario passes untouched. The pinned benign case and the
bug live on opposite sides of the bare/mixed line.

### Decision 3: Ship the partial fix and state the residual, rather than holding for a complete one

Decision 1 removes 85% of the failures (701 of 820) with zero regressions, but **119 remain**,
all `tiktoken`. The residual is the same bug one level up — a manufactured _mixed_ part can
also match verbatim by accident:

```
input : "\n� 👋\n\n.b�.\n ��"
parts : ["\n","�"," �","�","\n\n",".b","�",".\n"," ","��"]
                       ^^^^^^^^ manufactured from 👋 at index 3
```

The part `" �"` is mixed, so tier 2 runs, and `" �"` does occur verbatim at index 13. The cursor jumps to 15 and the following `"\n\n"` throws. Identifiability is a matter of
degree, not a binary: one real code unit alongside a manufactured U+FFFD is weak evidence.

Closing this needs something strictly stronger — validating a tier 2 match by checking the
part's non-U+FFFD skeleton against the source at the matched offset, or bounding the search
distance (rejected before, on different grounds). Both are larger than a spike, and neither is
needed to make the 85% improvement safe to ship. So: land Decision 1, and describe the
contract by what it actually guarantees.

**This is the one place the spec delta runs ahead of the implementation.**
[specs/multibyte-anchoring/spec.md](./specs/multibyte-anchoring/spec.md) is written for the
target behavior — positions independent of literal U+FFFD. Decision 1 does not fully deliver
it. Before archiving, either the residual is closed, or the delta's "A literal U+FFFD in the
source does not misdirect anchoring" requirement is narrowed to the bare-part case with the
mixed-part residual stated as a known limitation. **Do not archive this change without making
that call** — see `tasks.md` § 4.

## Acceptance criteria

Following the convention `tokenizer-length-inflation` set, the regression code lives here
until the fix lands, so `test/split.test.js` stays unconditional and green. Both tests below
fail at head and pass under Decision 1.

**1. Real-tokenizer regression.** Goes in `test/split.test.js` alongside the existing
`tiktoken` cases:

```js
it("does not anchor a manufactured replacement char on a literal one", () => {
  // tiktoken fragments the leading 漢 into two bare U+FFFD parts. The source
  // also holds a literal U+FFFD, which re-enables the verbatim search, so the
  // manufactured part used to match that literal one 13 code units downstream,
  // strand the cursor past " world", and throw.
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

  // The two manufactured parts anchor nothing; coverage still starts at the
  // first anchorable part and runs to the end of input.
  assert.strictEqual(chunks.at(-1).end, "漢ab�cd".length);
  assert.strictEqual(
    chunks[0].text,
    getChunk("漢ab�cd", chunks[0].start, chunks[0].end),
  );
});
```

**3. Differential fuzz gate.** The harness from Decisions above, kept as a one-off during the
spike rather than added to the suite (it needs both a patched and an unpatched tree). Bar to
clear before landing: **zero `OK→THROW` transitions** and **zero invariant violations** on
3,000 cases over a U+FFFD-bearing corpus. Record the final throw count in `tasks.md`.

**4. No linearity regression.** `npm test` includes the "grows linearly with input size"
scaling regression; it must stay green, since Decision 1 touches the same guard the tier 2
skip lives in. Confirmed green under Decision 1 (167/167).

## Risks / Trade-offs

- **[69 fuzz cases change chunk count while succeeding on both sides]** → These are baseline
  _silent_ mis-anchorings — the failure mode README:372 warns about ("a lowercased `"hi"` will
  happily anchor on some later `h`… yielding a wrong position with no error"). Correcting them
  is the point, but it means chunk counts and positions change for affected inputs, so this
  needs a changeset and the same "regenerate persisted embeddings" note the `0.3.0` rewrite
  carries. Not a patch release.
- **[A source's genuine U+FFFD is no longer anchored as a part]** → Its code units stay
  covered, absorbed forward into the previous chunk per `chunk-coverage`, so nothing is lost
  positionally. Only the part-level anchor disappears, and `chunkSize` counts parts, so an
  affected chunk may hold marginally more source. Same class of undercount already documented
  at README:389.
- **[The 119 residual throws]** → Not mitigated; deliberately scoped out by Decision 3, and
  the reason the spec delta must be reconciled before archiving. Stated, not hidden.
- **[Overlap with `tokenizer-length-inflation`]** → Both edit the same tier 2/tier 3 region of
  `anchorParts`, and that change's `research.md:36-43` already lists this shape as "a fourth
  instance of the same root cause". Whichever lands second rebases; if `tokenizer-length-
inflation` lands first with a cursor model that makes length-vs-span mismatch impossible,
  re-measure before assuming Decision 1 is still needed.
- **[The fix is one boolean expression, so it is easy to "simplify" back]** → The rejected
  alternative in Decision 1 is _exactly_ what a later reader would reduce it to. The
  bare/mixed distinction needs a comment at the call site and a line in AGENTS.md's algorithm
  map, or it will be undone.

## Open Questions

- Is the tier-2-match-validation refinement (compare the part's non-U+FFFD skeleton against
  the source at the matched offset) cheap enough to close the residual 119 without
  reintroducing a per-part cost proportional to part length? Deferrable: it does not change
  Decision 1, the task breakdown, or the delta as written — only whether § 4's reconciliation
  narrows the requirement or not.
