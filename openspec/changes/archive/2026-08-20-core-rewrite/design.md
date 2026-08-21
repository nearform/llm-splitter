## Context

Everything below was measured through the public API only — `split()` and `getChunk()`,
the two exports both versions share — by `test/benchmark.js` running this copy head to
head against published `llm-splitter@0.2.0`. "Old" means `0.2.0`; "new" means the rewrite.

Both versions satisfy `chunk.text === getChunk(input, chunk.start, chunk.end)` in all 270
scenarios, so neither is internally inconsistent. Old simply drops input on the floor
without reporting it. That is the point of the coverage contract: internal consistency was
never sufficient.

## Bug B — one unanchorable fragment desynchronizes every part after it

Old's `findMatches` tries `input.startsWith(splitPart, cursor)` first. When that fails it
falls back to a scan that needs a character `<= U+00FF` (`SINGLE_BYTE_CHAR_LIMIT`) to
anchor against. A part with no such character is skipped with `continue` — **without
advancing the cursor.**

That is survivable for Latin text, where the next part re-syncs on an ASCII character. For
text with no ASCII in it at all, nothing ever re-syncs: the cursor is stuck, `startsWith`
fails forever, and every remaining part is discarded.

```js
const tt = tiktoken.encoding_for_model("text-embedding-ada-002");
const td = new TextDecoder();
const splitter = (text) =>
  Array.from(tt.encode(text)).map((t) =>
    td.decode(tt.decode(new Uint32Array([t]))),
  );

const input = "这是一个测试文本用于检查分块边界的准确性。".repeat(10); // 210 code units, 220 tokens
split(input, { chunkSize: 64, splitter });

// OLD: 1 chunk covering 13 of 210 code units (6.2%); the other 197 silently discarded.
// NEW: 3 chunks covering 210 of 210 (100%).
```

The tokenizer splits `块` across two tokens, so decoding each alone yields U+FFFD. Tracing
old's loop, the cursor strands at 13 and never moves again:

```
part[10] "分"  cursor=12  MATCH [12,13)
part[11] "�"   cursor=13  DROPPED (no char <= U+00FF; cursor stays)
part[15] "界"  cursor=13  DROPPED (no char <= U+00FF; cursor stays)
part[16] "的"  cursor=13  DROPPED (no char <= U+00FF; cursor stays)
```

`part[15]` and `part[16]` are the tell: `界` and `的` decode _perfectly_ and sit verbatim in
the source. They are dropped purely because the cursor is stranded and they contain no
ASCII to recover with. At realistic document size the effect is total — 8400 code units of
CJK yields one chunk covering **0.15%** of the input.

**Fix.** The three-tier locate in `anchorParts`: `startsWith` at the cursor, then
`indexOf(splitPart, cursor)`, then `indexOf` of the part's first anchorable grapheme. Tier
2 re-syncs `界` and `的` because they exist verbatim in the source; tier 3 handles genuinely
byte-mutated parts. Nothing depends on ASCII. Now specified in `multibyte-anchoring` →
"Three-tier locate strategy".

Verified against an independent reference built from tiktoken's own byte stream (cumulative
per-token byte prefixes mapped to UTF-16 offsets): new matched chunk starts exactly,
**32/32 and 4/4 with zero drift**, where old matched 1/32 and 1/4 with a mean drift of 72
and a maximum of 152 code units.

## Bug C — a repeated paragraph anchors the group in the wrong place

In paragraph mode old found each group's offset by searching the joined input:

```js
baseOffset = inputAsString.indexOf(firstPart, baseOffset + 1);
```

The search starts one character past the _previous_ group's offset, so any earlier
occurrence of the paragraph's text wins. Repetitive documents — boilerplate, tables,
headers, generated text, translations — hit this routinely. Once a group is anchored behind
its true position, its parts can fall entirely before the last emitted chunk's end,
`hasUnEmittedParts()` reports nothing new, and **the final chunk is never emitted.**

Thirty-one characters is enough. The third paragraph, `"three four"`, also occurs inside
the second, `"two three four"`:

```js
const input = "one\n\ntwo three four\n\nthree four";
// true paragraph offsets: "one" [0,3)  "two three four" [5,19)  "three four" [21,31)
//   indexOf("three four", 6) -> 9   WRONG — found inside "two three four"; truth is 21.

split(input, {
  chunkSize: 3,
  splitter: (t) => t.split(" "),
  chunkStrategy: "paragraph",
});

// OLD: 2 chunks covering 17 of 31 code units — the third paragraph is missing entirely.
// NEW: 3 chunks covering 31 of 31.
```

Not sensitive to tuning: old loses it at `chunkSize` 3, 5 and 10 alike.

**Fix.** `boundaryGroups` carries each group's absolute `baseOffset` as arithmetic over
paragraph lengths plus the delimiter width, so a group's position never depends on searching
for its content.

## Design change A — chunk `end` extends forward

Not a bug on either side, but it accounts for most of the raw diff. Old ended each chunk at
its last anchored part, so text between parts — whitespace a splitter discarded, `\n\n`
delimiters, tokenizer-dropped fragments — belonged to no chunk. New extends every chunk's
`end` to the next chunk's `start`, and the last to end of input.

Trade-off: chunk text may carry trailing whitespace absorbed from the gap. A caller who
wants it gone can call `.trim()`; the reverse is impossible without re-reading the source.
Lossless library, lossy caller. Now specified in `chunk-coverage` → "Dropped code units
absorbed into previous chunk".

Worth knowing for upgrade expectations: the pass only fires when `chunks[i].end <
chunks[i+1].start`, which is rarely true once `chunkOverlap > 0` — adjacent chunks already
overlap. On overlapping configurations the change is nearly invisible; it is mainly visible
at `chunkOverlap: 0`.

The benchmark models this as the `coverage-extension` normalizer, rewriting the _baseline_
to follow the rule so the comparison isolates real differences from intended ones.
`node test/benchmark.js --explain` prints the full catalogue.

## Performance

New is faster in the median — 0.77x overall, by splitter: `whitespace` 0.56x, `char` 0.76x,
`tiktoken` 0.98x. 48 of 270 scenarios are slower at all and none is 2x or worse (worst
1.68x).

The tokenizer column is what moved. New initially carried one severe pathology — a
quadratic tier-2 anchor scan that made `character`-strategy splits O(n²) on tokenizer
output, worst row `devanagari 100KB character cs=512 tiktoken` at **25.6x slower than old**
(77ms → 1976ms). Part of that gap was the price of correctness, since old is fast there
precisely because it gives up (Bug B); 25x was not. It was fixed by the tier 2 skip, and
that row now reads 1.39x.

Devanagari earns its place in the corpus rather than being an exotic edge case: it is a
script (Hindi, Marathi, Nepali, Sanskrit and others — well over half a billion readers),
lives entirely within the BMP so there are no surrogate pairs, and every code point is 3
bytes in UTF-8 with one visible cluster routinely spanning several code points. BPE
tokenizers trained mostly on English cut _through_ those sequences, so decoding a single
token yields U+FFFD — a part existing in no verbatim form in the source. Latin text cannot
exercise that path at all.

The instrumentation, the measured tier-2 reach data, the three rejected alternatives
(bounded tier-2 window, up-front splitter classification, carried resync hint) and the
constants behind the scaling regression all live in the follow-on change:
[2026-08-20-anchor-scan-short-circuit/](../2026-08-20-anchor-scan-short-circuit/) —
`design.md`. That work is landed and its behavior is part of the `multibyte-anchoring`
contract.

## Regression coverage

All in `test/split.test.js`, running unconditionally under `npm test`. Each was confirmed to
fail against `0.2.0` and pass here, so they capture the fixes rather than merely describing
current behavior.

| Test                                                                   | Describe block            | Pins |
| ---------------------------------------------------------------------- | ------------------------- | ---- |
| `covers the whole input when a tokenizer fragments text with no ASCII` | `non-ASCII anchoring`     | B    |
| `locates ordinary parts that follow an unanchorable fragment`          | `non-ASCII anchoring`     | B    |
| `anchors a string paragraph whose text repeats earlier in the input`   | `paragraph group offsets` | C    |

The first uses the real tokenizer; the second a synthetic splitter emitting U+FFFD at a
fixed interval — the same shape without the tokenizer version as a variable.

`contract fuzz` → "holds the coverage contract across randomized inputs" generalizes these:
20,000 seeded cases over 11 splitters x 9 alphabets x both strategies x random
size/overlap, asserting the full contract and additionally that a **non-mutating splitter
never fails to anchor** — the property that regressed historically.

## Real-world validation

Beyond the synthetic matrix, both versions were run through a production RAG pipeline
(`gte-small` via `@xenova/transformers`, `paragraph` strategy, `chunkOverlap: 10`) over 943
blog posts / 7.85 MB, at both configured chunk sizes:

|                              | old (0.2.0)                | new             |
| ---------------------------- | -------------------------- | --------------- |
| coverage, cs=231             | 99.952%                    | **100.000%**    |
| coverage, cs=487             | 99.978%                    | **100.000%**    |
| unattributable code units    | 3807 / 1722                | **0 / 0**       |
| adjacency gaps               | 31 / 11                    | **0 / 0**       |
| posts whose last chunk short | 4 / 4                      | **0 / 0**       |
| chunks over the token limit  | 10 (max 285) / 7 (max 590) | **1 (259) / 0** |
| `text === getChunk()`        | holds                      | holds           |

The token-limit row is the practical consequence: `gte-small` silently truncates input past
512 tokens, so old was feeding it chunks whose tails were discarded by the model — one at
590, losing ~78 tokens. Old undercounted because dropped parts meant `chunkSize` no longer
reflected what the chunk actually held.

Upgrade shape on the same corpus: **~94% of chunks byte-identical** to old, ~5.5%
re-anchored (B/C), ~0.4% forward-extended (A), 0 chunks gained trailing whitespace at
`chunkOverlap: 10`, and **new never loses a chunk old had**. Chunking wall-clock was at
parity on identical hardware (0.96–0.98x).
