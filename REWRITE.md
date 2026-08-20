# Rewrite: what changed vs. the published library

Findings from running [test/benchmark.js](test/benchmark.js) head-to-head against
the published `llm-splitter` across 270 scenarios (3 corpora x 3 input sizes x 2
chunk strategies x 3 chunk sizes x 2 overlaps x 3 splitters).

Everything below is measured through the public API only — `split()` and
`getChunk()`, the two exports both versions share.

## Summary

|     | difference                                                           | kind              | scope                                   |
| --- | -------------------------------------------------------------------- | ----------------- | --------------------------------------- |
| A   | Chunk `end` extends forward to the next chunk's `start`              | **design change** | explains 100 of 196 differing scenarios |
| B   | Old discards splitter parts containing no character `<= U+00FF`      | **bug in old**    | most of the 96 real differences         |
| C   | Old locates paragraph groups with `indexOf(paragraph, previous + 1)` | **bug in old**    | all 13 `char`-splitter real differences |

Aggregate consequence of B and C: **the published library leaves 1,179,904 code
units unattributable across 186 of 270 scenarios. This copy leaves 0 in 0.**

Both versions satisfy `chunk.text === getChunk(input, chunk.start, chunk.end)` in
all 270 scenarios, so neither is internally inconsistent. Old simply drops input
on the floor without reporting it.

Perf is covered in the [Devanagari](#the-devanagari-case-why-this-copy-can-be-much-slower)
section: this copy is faster in the median and has one severe, fixable pathology.

---

## Bug B — one unanchorable fragment desynchronizes every part after it

### What old does

`findMatches` tries `input.startsWith(splitPart, cursor)` first. When that fails
it falls back to a scan that needs a character `<= U+00FF` (`SINGLE_BYTE_CHAR_LIMIT`)
to anchor against. A part with no such character is skipped with `continue` —
**without advancing the cursor**.

That is survivable for Latin text, where the next part re-syncs on an ASCII
character. For text with no ASCII in it at all, nothing ever re-syncs: the cursor
is stuck, `startsWith` fails forever, and every remaining part is discarded.

### Reproduction

```js
import { split } from "llm-splitter";
import tiktoken from "tiktoken";

const tt = tiktoken.encoding_for_model("text-embedding-ada-002");
const td = new TextDecoder();
const splitter = (text) =>
  Array.from(tt.encode(text)).map((token) =>
    td.decode(tt.decode(new Uint32Array([token]))),
  );

const input = "这是一个测试文本用于检查分块边界的准确性。".repeat(10);
// 210 code units, 220 tokens

const chunks = split(input, { chunkSize: 64, splitter });

// OLD: 1 chunk, covering 13 of 210 code units (6.2%)
//      chunks[0].text === "这是一个测试文本用于检查分"
//      the other 197 code units are silently discarded
//
// NEW: 3 chunks, covering 210 of 210 code units (100%)
```

### Why it stops exactly there

Tracing old's matching loop over the same input. The tokenizer splits the
character `块` across two tokens, so decoding each token alone yields U+FFFD
replacement characters:

```
part[10] "分"   cursor= 12  MATCH [12,13)
part[11] "�"  cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[12] "�"  cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[13] "�"  cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[14] "�"  cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[15] "界"   cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[16] "的"   cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
part[17] "�"  cursor= 13  DROPPED (no char <= U+00FF; cursor stays at 13)
```

Note `part[15]` and `part[16]`: `界` and `的` decode _perfectly_. They are ordinary
characters sitting verbatim in the source. They are dropped purely because the
cursor is stranded at 13 and they contain no ASCII to recover with.

At realistic document size the effect is total — 8400 code units of CJK yields one
chunk covering **0.15%** of the input.

### What this copy does

Three-tier locate in `anchorParts` ([src/split.js](src/split.js)): `startsWith` at
the cursor, then `indexOf(splitPart, cursor)`, then `indexOf` of the part's first
anchorable grapheme. Tier 2 re-syncs `界` and `的` because they exist verbatim in
the source; tier 3 handles genuinely byte-mutated parts. Nothing depends on ASCII.

Verified against an independent reference built from tiktoken's own byte stream
(cumulative per-token byte prefixes mapped to UTF-16 offsets): this copy matched
chunk starts exactly, **32/32 and 4/4 with zero drift**, where old matched 1/32 and
1/4 with a mean drift of 72 and a maximum of 152 code units.

---

## Bug C — a repeated paragraph anchors the group in the wrong place

### What old does

In paragraph mode old finds each group's offset by searching the joined input:

```js
baseOffset = inputAsString.indexOf(firstPart, baseOffset + 1);
```

The search starts one character past the _previous_ group's offset, so any earlier
occurrence of the paragraph's text — anywhere after that point — wins. Repetitive
documents (boilerplate, tables, headers, generated text, translations) hit this
routinely.

Once the group is anchored behind its true position, its parts can end up entirely
before the last emitted chunk's end. `hasUnEmittedParts()` then reports nothing new
and **the final chunk is never emitted**.

### Reproduction

Thirty-one characters is enough. The third paragraph, `"three four"`, also occurs
inside the second paragraph, `"two three four"`:

```js
import { split } from "llm-splitter";

const input = "one\n\ntwo three four\n\nthree four";
//              ^0        ^5              ^21
// paragraph offsets: "one" [0,3)  "two three four" [5,19)  "three four" [21,31)

// How old resolves each group:
//   indexOf("one",            0) ->  0   correct
//   indexOf("two three four", 1) ->  5   correct
//   indexOf("three four",     6) ->  9   WRONG — true offset is 21.
//                                        Found inside "two three four".

const chunks = split(input, {
  chunkSize: 3,
  splitter: (text) => text.split(" "),
  chunkStrategy: "paragraph",
});

// OLD: 2 chunks, covering 17 of 31 code units
//      [[0,3], [5,19]] -> ["one", "two three four"]
//      the entire third paragraph is missing from the output
//
// NEW: 3 chunks, covering 31 of 31 code units
//      [[0,5], [5,21], [21,31]] -> ["one\n\n", "two three four\n\n", "three four"]
```

The dropped paragraph is not sensitive to tuning — old loses it at `chunkSize` 3, 5
and 10 alike.

### What this copy does

`boundaryGroups` carries each group's absolute `baseOffset` as arithmetic over
paragraph lengths plus the delimiter width, so a group's position never depends on
searching for its content. The docstring already claimed robustness here; this is
the measured confirmation, on ordinary repetitive text rather than a contrived
string.

---

## Design change A — chunk `end` extends forward

Not a bug on either side, but it accounts for most of the raw diff and is worth
stating plainly.

Old ends each chunk at its last anchored part, so text between parts (whitespace a
splitter discarded, `\n\n` delimiters, tokenizer-dropped fragments) belongs to no
chunk. This copy extends every chunk's `end` to the next chunk's `start`, and the
last chunk to the end of input, so every code unit from `chunks[0].start` onward is
attributable to exactly one chunk.

Trade-off: chunk text may carry trailing whitespace absorbed from the gap. A caller
who wants it gone can call `.trim()`; the reverse is impossible without re-reading
the source. Lossless library, lossy caller.

The benchmark models this as the `coverage-extension` normalizer — it rewrites the
_baseline_ to follow this rule, so the comparison isolates real differences from
intended ones. `node test/benchmark.js --explain` prints the full catalogue.

---

## The Devanagari case: why this copy can be much slower

### What Devanagari is

Devanagari (देवनागरी) is a **script, not a language**. It is used to write Hindi,
Marathi, Nepali, Sanskrit, Konkani, Maithili and others — well over half a billion
readers. It is a left-to-right abugida: consonants carry an inherent vowel that is
modified by attached vowel signs (_matras_), consonants combine into conjunct
ligatures, and a horizontal headstroke (_shirorekha_) runs across the top of a word.

Two properties make it a useful stress test, and neither is exotic:

- It lives in Unicode block `U+0900–U+097F` — entirely within the BMP, so there are
  no surrogate pairs. Bugs found here are not "astral plane" edge cases.
- Every code point is **3 bytes in UTF-8**, and one visible cluster is routinely
  several code points (base consonant + vowel sign + virama + …).

BPE tokenizers trained mostly on English have no whole-token entries for most of
this, so they emit tokens that cut _through_ those 3-byte sequences. Decoding such a
token alone produces U+FFFD rather than text — a part that exists in no verbatim
form in the source. That is the case both libraries have to handle, and it is why
the corpus is in the matrix: Latin text cannot exercise this path at all.

### The measurements

This copy is **faster overall** — median ratio ~0.6–0.7x, i.e. roughly 1.5x faster.
Only 74 of 270 scenarios are slower at all, and they are almost entirely tokenizer
scenarios:

| splitter     | median ratio (new / old) |
| ------------ | -----------------------: |
| whitespace   |                    0.46x |
| char         |                    0.66x |
| **tiktoken** |                **1.70x** |

But 21 scenarios are 2x or worse, and the tail is bad:

```
devanagari 100KB character cs=512 tiktoken    old=77ms   new=1976ms   25.6x
```

### Why

Instrumenting a copy of `anchorParts` to count which tier each part resolves through:

```
latin      100KB    24ms  parts= 20558  tier1=20558  tier2MISS=    0  scanned=   0.0M
cjk        100KB   379ms  parts=135426  tier1=46330  tier2MISS=69784  scanned=3572.8M
devanagari 100KB  1954ms  parts=102073  tier1=25072  tier2MISS=64474  scanned=3292.4M
                                                                       tier3=13915
```

The cost is **tier 2 failing**. When `startsWith` misses, the code runs
`input.indexOf(splitPart, cursor)`; if the part is not verbatim in the source — the
U+FFFD case above — that call scans all the way to the end of the string before
returning `-1`. With O(n) such parts the whole split becomes O(n²). The scan volume
confirms it exactly: 10x the input gives 100x the work (35.7M → 3572.8M).

Devanagari costs ~5x what CJK does at comparable scan volume because 13,915 of its
misses go on to reach tier 3 with a real anchor grapheme, paying an `Intl.Segmenter`
pass plus a second `indexOf`. CJK's misses are mostly pure U+FFFD, discarded after a
cheap segmentation.

Two honest framings of the gap:

- Part of it is the price of correctness. Old is fast here precisely because it gives
  up — no ASCII character means `continue`, no search at all — which is exactly Bug B.
- But 25x is **not** that price. It is a fixable algorithmic flaw, and it is the same
  O(n²) shape that `findGrapheme` had before `indexOf` replaced it. The quadratic
  moved to the failure branch rather than going away.

### Options to explore (sketches, not a plan)

Notes for a later design pass. None of these are costed or validated yet.

1. **Short-circuit on U+FFFD.** Test `splitPart.includes("�")` before tier 2 and
   go straight to tier 3 when true. An O(part length) check against an O(remaining
   input) scan; would remove most misses outright. Does not help parts mutated
   without producing U+FFFD.

2. **Bound the tier-2 search window.** A part belongs at or near the cursor, so
   search `cursor … cursor + splitPart.length + slack` first and only widen on
   failure — ideally by doubling, up to the full remaining string, which keeps the
   current worst case as a fallback while making the common case constant-time.
   Needs a defensible slack: splitters that legitimately drop long spans (whitespace
   runs, stripped markup) must still resolve.

3. **Classify the splitter once, up front.** Probe on first use — for example whether
   the parts rejoin to the input — and pick a strategy per splitter instead of
   re-discovering per part. Amortizes the decision across the whole document.

4. **Carry a resync hint across failures.** Today each failed part independently
   rescans from the cursor. Remembering that the splitter is byte-mutating, or how
   far the last successful anchor advanced, could avoid repeating the same doomed
   scan thousands of times.

Whatever is chosen has to hold two lines, both of which the benchmark already
measures: the coverage invariant (`gap` column stays `0` on the new side) and
anchoring exactness (residual count must not rise above the current baseline —
`latin real=5`, all `anchor-drift`). Measure, don't reason: the `findGrapheme`
slow path was assumed fine until it was benchmarked.

---

## Regression coverage

Both bugs are pinned in [test/split.test.js](test/split.test.js) and run as part of
`npm test`:

| test                                                                   | describe block            |
| ---------------------------------------------------------------------- | ------------------------- |
| `covers the whole input when a tokenizer fragments text with no ASCII` | `non-ASCII anchoring`     |
| `locates ordinary parts that follow an unanchorable fragment`          | `non-ASCII anchoring`     |
| `anchors a string paragraph whose text repeats earlier in the input`   | `paragraph group offsets` |

The first uses the real tokenizer, the second a synthetic splitter that emits
U+FFFD at a fixed interval — the same shape without the tokenizer version as a
variable. All three were confirmed to fail against the published library and pass
here, so they capture the fixes rather than merely describing current behavior.

## Reproducing this

```sh
git clone https://github.com/nearform/llm-splitter ../llm-splitter
cd ../llm-splitter && npm ci && npm run build

node test/benchmark.js --diff          # classified diff + real differences
node test/benchmark.js --explain       # documented differences and residual labels
node test/benchmark.js --corpus=latin  # original 90-scenario matrix only
node test/benchmark.js --raw           # compare verbatim, no normalization
node test/benchmark.js --diff-json=out.json
```

Piping or redirecting drops the ANSI color, so the table pastes into Markdown as-is.
