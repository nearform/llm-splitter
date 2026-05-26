# Tokenizer length inflation

> **Status:** open. Captured here for future work; may be promoted to a GitHub
> issue. Tracked internally as "B7" in
> [/Users/rye/.claude/plans/i-want-an-adversarial-warm-peach.md](../) (the
> adversarial review plan).

## Problem

`llm-splitter` anchors each splitter part against the source string and
records `chunk.start` / `chunk.end` so downstream consumers can locate
chunks in the original input. This depends on the splitter producing tokens
whose decoded string length **equals the number of source bytes (UTF-16
code units) consumed**. When that assumption holds, the cursor advances
correctly:

```
cursor_after_part = cursor_before_part + splitPart.length
```

Some real tokenizers violate this assumption.

| Tokenizer family                                                                                                                                                      | Decoded length vs source bytes                                                                                                                                      | Current support                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `text.split('')` (char)                                                                                                                                               | 1:1                                                                                                                                                                 | ✅ exact                                         |
| `text.split(/\s+/)` (whitespace)                                                                                                                                      | shorter (drops separator bytes; whole token is verbatim in source)                                                                                                  | ✅ exact (caught by tier 2 `indexOf(splitPart)`) |
| `tiktoken` (OpenAI cl100k, ada-002, gpt-4o, …)                                                                                                                        | 1:1 — each undecodable byte becomes exactly one U+FFFD                                                                                                              | ✅ exact                                         |
| Embedding models with a normalizing tokenizer pipeline (e.g. `gte-small`, `bge-small`, uncased BERT-style WordPiece; commonly served via `@huggingface/transformers`) | **can be longer** — the model's tokenizer config applies normalization (lowercase, accent strip, NFC/NFD) at decode time, so decoded length can exceed source bytes | ❌ throws or produces wrong positions            |
| Custom splitters that mutate token text (uppercase, normalize, etc.)                                                                                                  | varies                                                                                                                                                              | ❌ documented as unsupported                     |

The embedding-model case is the live concern: those tokenizers are widely
used for RAG pipelines and `llm-splitter`'s primary audience is RAG
authors. To be precise, it's the _model_'s tokenizer configuration that
introduces the inflation — `transformers.js` and similar runtimes just
execute whatever encode/decode pipeline the model ships in
`tokenizer.json`. A given runtime is not "broken"; the model's normalizer
is doing what it was trained to do.

## How it fails today

When a tokenizer inflates a token's decoded length, `cursor` advances past
where the next token actually starts in source. Two symptoms follow:

1. **Hard throw** — a later token's anchor grapheme isn't present at-or-after
   the over-advanced cursor. `anchorParts` raises `Splitter returned a part
that could not be located in input (…)`. Loud failure, easy to detect.
2. **Wrong anchoring** — the over-advanced cursor still finds _some_ match
   for the next token's anchor (e.g. the same letter reappearing later in
   the text). Anchored positions get attributed to the wrong source bytes;
   downstream consumers think the chunk covers content it doesn't.

Symptom 2 is the more dangerous one because it's silent.

## What the synthetic regression test captures

[test/split.test.js:1397](../test/split.test.js#L1397) holds a deliberately
length-inflating splitter that appends U+FFFD to every character. It runs
under `it.todo` so the suite stays green; the assertion is what we want a
fixed B7 to produce. Today it throws at the second token.

```js
const driftSplitter = (text) => text.split("").map((ch) => ch + "�");
// For "abc": ["a�", "b�", "c�"]
//   each splitPart.length === 2, but source span === 1
// At "b�": cursor=2, but 'b' lives at source position 1.
```

The test is intentionally synthetic. It models the **shape** of the
problem (length > source span) without depending on a transformers.js
install or a particular model file. Once B7 has a real fix, this test
should pass; the real-world fixture (below) should also pass.

## What was attempted in Phase 2 and why it was reverted

A hybrid cursor was tried: keep length-based `end` for chunk position
(preserves the "lossless" coverage invariant) but compute cursor via an
anchor walk through `splitPart`'s graphemes. The intent was "cursor tracks
the _source_ span, end tracks the _decoded_ span."

It broke `tiktoken` on a Devanagari fixture (`"Hindi: नमस्ते दुनिया"`). Trace:

1. tiktoken emits a token `" �"` (space + U+FFFD; source span = 2 UTF-16
   units: space + first byte of ु).
2. Anchor walk found just the space anchor → cursor advanced by **1**.
3. Length-based cursor would have advanced by **2** (landing on `ु`).
4. Next token, the precomposed grapheme `ु`, tried `startsWith` at the
   under-advanced cursor → matched whitespace, fast path failed.
5. Fell into slow path, looked for `ु` from a position one earlier than
   expected → wrong anchoring or `findGrapheme` returning a position that
   broke subsequent tokens.

The anchor walk **undershoots** for tiktoken because the source span equals
the decoded length but only some of those bytes are anchorable graphemes
(the rest are U+FFFD or combining marks). Using only the anchors as a
ruler gives an answer that's correct for the synthetic inflation case but
wrong for tiktoken.

Reverting was the right call — the fix needs to _detect_ which mode the
splitter is in, not pick one universal cursor strategy.

## Possible directions

These are not mutually exclusive. Listed cheapest first.

### A. Inflation detection per part

After locating `start`, compare `splitPart`'s code-point stream against
`input[start..]` until they diverge. The position of divergence (in
`input`) minus `start` is the actual source span. If that's smaller than
`splitPart.length`, the part was inflated; use the divergence position as
`cursor_after`.

```
for i = 0 to min(splitPart.length, input.length - start):
  if splitPart[i] !== input[start + i] and splitPart[i] !== U+FFFD:
    cursor_after = start + i
    break
else:
  cursor_after = start + splitPart.length
```

The check `splitPart[i] !== U+FFFD` is what makes this distinct from a
straight byte-comparison: tiktoken's FFFDs are allowed to "match" any
source byte at the corresponding position, since they represent
un-decoded bytes that are still present in source.

- ✅ Local, per-part, no global classification.
- ✅ Should handle both tiktoken (no inflation triggers divergence; cursor
  advances by full length) and HF normalization (extra normalizing chars
  trigger divergence; cursor stops at real source position).
- ⚠️ Need to think carefully about combining marks (does the splitter's
  combining mark represent itself in source, or was it inserted by
  normalization?). May need a similar "always matches" exemption.
- ⚠️ Cost: O(splitPart.length) per part. Total O(input.length) across all
  parts in the byte-preserving case. Acceptable.

This is currently my preferred candidate.

### B. Tokenizer-kind option

Add `{ splitterKind: "exact" | "tiktoken" | "huggingface" }`:

- `"exact"` (default): byte-preserving splitters. Current behavior.
- `"tiktoken"`: 1:1 byte:char with FFFD substitution. Current behavior is
  already correct.
- `"huggingface"` (or `"normalizing"`): expect inflation. Use anchor-based
  cursor or option A's detection.

- ✅ Explicit, no heuristics.
- ❌ Adds API surface; users have to know which mode their tokenizer needs.
- ❌ Doesn't help users who write their own splitter wrapping an unfamiliar
  tokenizer.
- 🤔 Could combine with A: option A is the default; `splitterKind` is an
  optional override for users who want determinism.

### C. Two-pass fallback

Run normally with length-based cursor. If `anchorParts` would throw
"could not be located", catch internally, restart `anchorParts` for that
group with anchor-based cursor logic.

- ✅ Handles the loud-throw case gracefully.
- ❌ Doesn't help with the silent-wrong-anchoring case (symptom 2).
- ❌ Doubles work on failure.
- ❌ Genuine splitter bugs (e.g. lowercasing) shouldn't get retried.

### D. Per-call detection via classifier

After processing the first few parts, classify the splitter:

- If `parts[i].end === parts[i+1].start` consistently → byte-preserving →
  length-based cursor.
- Else → check inflation profile, choose strategy.

Similar trade-offs to A but requires running multiple parts first before
deciding, which is awkward in the streaming loop. Likely strictly worse
than A.

### E. Punt — document as unsupported

Lock in the current behavior with a clear "not supported" notice for
length-inflating tokenizers. Users who hit this work around by:

1. Switching to tiktoken or another 1:1 tokenizer (often acceptable for
   chunking even if their embedding model differs).
2. Wrapping their model's tokenizer to pad/trim decoded output to match
   source length.

Acceptable if A turns out to be infeasible; documenting upfront is also
the right move regardless of which direction we go (so users hit it
loudly, not silently).

## Test fixture plan

A real-world B7 fix needs a model whose tokenizer pipeline triggers the
inflation. The easiest delivery vehicle in JS is `transformers.js` loading
a model like `gte-small`. Plan:

1. Add `@huggingface/transformers` as a **dev** dependency only (don't
   force it on consumers).
2. Build a `tokenSplitter` helper similar to the tiktoken one in
   `test/split.test.js`. Load `gte-small` (or whichever lightweight model
   reproduces the inflation; `bge-small` is a fallback). The model file
   determines normalizer behavior — picking the right model is the
   important part, the runtime is incidental.
3. Reproduce the failure: input that triggers the model's normalizer
   (lowercase, accent stripping, NFD/NFC differences). Suggested fixtures:
   - `"CAFÉ"` — uppercase + accented; `gte-small` is uncased and likely
     normalizes.
   - `"naïve résumé"` — accent stripping.
   - Multibyte: `"こんにちは world"` — CJK to verify cursor isn't broken
     for byte-preserving multibyte after fix.
4. Write the assertions for the **post-fix** expected behavior (chunks
   that cover source correctly), and mark `it.todo` until B7 lands. Pair
   with the synthetic test so both pass when the fix is correct.
5. If the `transformers.js` install is heavy enough to slow `npm install`,
   gate the test behind an env var (`B7_TEST=1 npm test`) or skip when
   the dep isn't resolvable. Don't make CI mandatory until B7 is fixed.

Other models worth eyeballing once the fixture works:

- `Xenova/bge-small-en-v1.5` — similar normalization profile.
- `Xenova/all-MiniLM-L6-v2` — popular default for embedding pipelines.
- `Xenova/multilingual-e5-small` — exercises broader Unicode.

## Why we deferred from Phase 2

The original adversarial review identified B7 in Phase 1 with a synthetic
regression test. Phase 2 attempted the hybrid fix described above; it
broke tiktoken; reverted. Concurrently, the user identified `gte-small`
(typically loaded via `transformers.js`) as the real-world driver — a
model whose tokenizer pipeline applies decode-time normalization. Without
that fixture available locally, blind algorithm changes weren't going to
converge.

## Phase 1 findings (2026-05-25, real gte-small fixtures)

After wiring `@huggingface/transformers` v4 + `Xenova/gte-small` into the test
suite as B7-real regression tests (see
[test/split.test.js](../test/split.test.js), `regressions` describe block,
gated by `B7_TEST=1`), the failure modes are concrete and partly differ from
this doc's original framing.

### What the tokenizer actually emits

For the headline fixture `"Hi there. I'm Evän."`, per-token decode produces:

```
["[CLS]","hi","there",".","i","'","m","evan",".","[SEP]"]
```

Two classes of mutation are visible in this single input:

1. **Special tokens** `[CLS]`/`[SEP]` — zero source span, framing the input.
2. **Lowercase + accent strip** — `"Hi"` → `"hi"`, `"Evän"` → `"evan"`.
   NFD + lowercase + strip-accents is gte-small's normalizer pipeline,
   applied at encode time and never inverted on decode. Note the
   first-character mutation `"H"` → `"h"`: this is what breaks Tier 1
   `startsWith` and Tier 2 `indexOf` at position 0, even though both source
   and decoded forms have identical length.

The third class — **WordPiece `##` continuation prefixes** — is exercised by
the `"こんにちは world"` fixture, where decode of each CJK subword token
returns the `##`-prefixed form verbatim. For example `"##ん"` has decoded
length 3 versus source span 1 for `"ん"`. **That's genuine length inflation
in the original B7 sense.** Longer English inputs with multi-syllable
out-of-vocab words would exercise it too, but the deliberately small
headline fixture above does not.

### Failure mode by helper and fixture

Tested with `chunkSize: 4`. Two helpers:

- `gteSmallSplitterNaive` — encode + decode-each-token, no filtering.
- `gteSmallSplitter` — same, but filters `[CLS]`/`[SEP]`/`[UNK]`.

| Fixture                 | Truly naive      | Almost-naive                                                                       |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `"Hi there. I'm Evän."` | Throw on `[CLS]` | Throw on `"there"` (after silent mis-anchor of `"hi"` to the `h` inside `"there"`) |
| `"CAFÉ"`                | Throw on `[CLS]` | Throw on `"cafe"` (no lowercase `c` anywhere in source)                            |
| `"naïve résumé"`        | Throw on `[CLS]` | **Passes** (anchors `n`→0 and `r`→6 happen to be correct)                          |
| `"こんにちは world"`    | Throw on `[CLS]` | Throw on `"##ん"` (Tier 3 anchors on literal `#`, not present in source)           |
| `"hello world"`         | Throw on `[CLS]` | **Passes** (no mutation: source already lowercase ASCII)                           |

Eight of ten tests fail; the two that pass succeed only because their
first-non-FFFD grapheme happens to match source verbatim.

### What this changes vs. the original analysis

1. **"Inflation" is one of three problems, not the dominant one.** The
   original doc framed B7 as decoded length exceeding source span. That's
   real for WordPiece `##` prefixes (`"##ん"` length 3 vs span 1) and for
   special tokens (length 5 vs span 0). But the **more common and more
   dangerous** failure for gte-small is **content mutation with equal
   length** — `"hi"` (length 2) vs source `"Hi"` (length 2). Same length, no
   inflation, but Tier 1 `startsWith` and Tier 2 `indexOf` both fail because
   the bytes differ, forcing Tier 3 anchor-grapheme lookup, which then
   either throws or silently picks a wrong position.

2. **The "silent mis-anchoring" warned about in the original doc happens,
   but a later throw usually catches it.** In the headline fixture,
   `"hi"` silently mis-anchors into the `"there"` part of the input (the
   first lowercase `h` after position 0), but the next token `"there"`
   then has nowhere to anchor and throws. The silent corruption is
   _masked_ by the cascading hard failure — which is good in practice (loud
   error eventually) but bad for diagnosis (the error names the wrong
   token). Cases where the mis-anchor doesn't cascade — e.g., where every
   token happens to have a unique anchor grapheme present at the right
   spot — would silently produce wrong `start`/`end`. `"naïve résumé"`
   passes purely because `n` and `r` are each unique and in the right place;
   add a second `r` later in the input and it would mis-anchor silently.

3. **Tier 3 `firstAnchorGrapheme` actively harms when the splitter is
   normalizing.** It assumes any non-FFFD grapheme in the part is a faithful
   stand-in for source bytes. That holds for tiktoken's FFFD-substitution
   pattern but breaks for case- or accent-mutated graphemes (looks fine,
   anchors wrong) and for WordPiece `##` (anchors on the `#` literal, which
   isn't in source). A fix that's robust here probably needs to
   normalize-then-compare both sides (e.g. NFD + lowercase + strip-accents on
   a window of source bytes before anchoring) rather than trust the part's
   bytes.

4. **The "library reslices chunk.text from source" behavior is doing real
   work for us.** For `"naïve résumé"` the splitter returns
   `["naive","resume"]` but `chunk.text` comes back as `"naïve résumé"` —
   sliced from the source string using `start`/`end`, not concatenated from
   splitter output. So when anchors land in the right places the output is
   semantically correct even though the splitter mutated content. The risk
   surface is entirely in the anchor positions, not the text payload.

### Implications for Phase 2

The original doc's **Direction A** (per-part inflation detection by
comparing splitPart code-points against source until divergence, with FFFD
as a wildcard) addresses the WordPiece `##` case and the special-token case
but **does not address content mutation with equal length** — the
divergence detector would correctly report "length 2 part diverges from
source at index 0" and stop the cursor at the start, but it still wouldn't
tell us _where in source_ the part belongs.

Two complementary changes seem necessary:

- **Pre-anchor: detect zero-source-span tokens** (special tokens like `[CLS]`
  whose decoded form contains no source-anchorable graphemes). These should
  emit an empty chunk position or be skipped, not propagate the cursor.
- **Tier 3 replacement: normalized comparison anchor**. Instead of
  `indexOf(firstAnchorGrapheme(splitPart), cursor)`, walk forward in source
  from `cursor` applying the same normalization the splitter would
  (NFD + lowercase + strip-accents + `##`-strip if user opts in) and find
  the first position where `normalize(source[i..])` starts with
  `normalize(splitPart)`. This is more expensive but only kicks in on
  Tier 3 fallback, and it's the only thing that correctly handles mutated
  content.

The cleanest API shape is probably an opt-in normalization function passed
alongside the splitter: `split(input, { splitter, sourceNormalize })`.
Library default is identity. Users wiring up gte-small can pass
`sourceNormalize: (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")`
or equivalent. That's still cheaper than `splitterKind` enums from
Direction B and doesn't require classification heuristics from Direction D.

This is approximate — the real Phase 2 design needs to validate that
proposal against tiktoken's existing fixtures (especially the Devanagari one
that broke in the prior hybrid-cursor attempt). The point of Phase 1 is
that the design space is now substantially narrower: inflation detection
alone isn't sufficient.

### Workaround status

The current production workaround (from `nearform/joyce`) — lowercase input
before `split`, strip `##` and special tokens from decoded output — works
because it neutralizes both mutation classes from the splitter side. It
costs the user a separate `[start, end]` lookup against the source-cased
text (joyce uses `getChunk` against an un-lowercased copy). Acceptable for
one-off integrations; not a long-term posture for a "RAG-first" library.

## References

- [test/split.test.js:1397](../test/split.test.js#L1397) — synthetic
  regression test (`it.todo`).
- [test/split.test.js](../test/split.test.js) `regressions` block —
  B7-real fixtures using gte-small, gated by `B7_TEST=1`.
- [src/split.js:155-188](../src/split.js#L155-L188) — three-tier locate
  strategy in `anchorParts`. Tier 3 (`firstAnchorGrapheme` + `indexOf`)
  is what would need to change for inflation handling.
- [README.md](../README.md) "Multibyte / Unicode Strings" — current
  user-facing description; needs a tokenizer-constraint note added (see
  parallel work for that).
- `~/.claude/projects/-Users-rye-scm-nf-llm-splitter-rewrite/memory/project_tokenizer_length_inflation.md`
  — agent-side note linking this work to ongoing development.
