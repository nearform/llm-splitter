# Research: tokenizer length inflation

Evidence record for this change. The decisions live in [design.md](./design.md); this
file holds the empirical detail behind them — the parts that cost a 23 MB model download
to re-derive.

## Splitter families vs. the anchoring assumption

`anchorParts` advances `cursor += splitPart.length`, which assumes a part's decoded
length equals the source span it consumed.

| Splitter family                                                                | Decoded length vs source span                        | Support               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------- |
| `text.split('')`                                                               | 1:1                                                  | exact                 |
| `text.split(/\s+/)`                                                            | shorter — drops separators, token verbatim in source | exact (Tier 2)        |
| `tiktoken` (cl100k, ada-002, gpt-4o)                                           | 1:1 — one U+FFFD per undecodable byte                | exact                 |
| Normalizing embedding tokenizers (`gte-small`, `bge-small`, uncased WordPiece) | differs in both length **and** content               | throws or mis-anchors |

It is the _model's_ tokenizer config that normalizes (lowercase, accent strip, NFD), not
the runtime — `@huggingface/transformers` executes whatever ships in `tokenizer.json`.

## Three failure modes

1. **Length inflation** — decoded length exceeds source span. `"##ん"` is length 3 vs
   span 1; `"[CLS]"` is length 5 vs span 0. The cursor overshoots real source bytes.
2. **Equal-length content mutation** — same length, different bytes: `"Hi"` → `"hi"`,
   `"Evän"` → `"evan"`. Tiers 1 and 2 both fail; Tier 3 throws or mis-anchors. This is
   the **most common gte-small mode**, and it is not what "length inflation" originally
   described.
3. **Zero-span control tokens** — `[CLS]`, `[SEP]`, `[UNK]` decode to text but consume no
   source. Tier 3 anchors them on a literal `[` if one happens to exist.

Each surfaces as either a hard throw (loud, easy to spot) or silent mis-anchoring —
usually masked by a later cascading throw that then names the wrong token.

A fourth instance of the same root cause, from a different direction: a **source that itself
contains a literal U+FFFD**. Tier 2 then matches a decode-produced U+FFFD against an unrelated
literal one further along, the length-based advance carries the cursor past real source, and
the next part throws or mis-anchors. It is the same length-vs-span mismatch as mode 1, reached
without any normalization. Confirmed identical before and after `anchor-scan-short-circuit`
(that change's tier 2 skip switches itself off precisely when the source contains U+FFFD, so
it neither helps nor hurts here).

**No longer open here.** This shape is owned by `literal-replacement-char-anchoring`, which
fixes it in two edits: Tier 3 stops treating the anchor grapheme's position as the part's
position (`indexOf(anchor.segment, cursor + anchor.offset) - anchor.offset`), and Tier 2 is
then skipped for every U+FFFD-bearing part. Measured there at 0 throws across 15,000 fuzz
cases with zero `OK→THROW`. A benign residual remains: Tier 1's `startsWith` still cannot tell
a manufactured bare U+FFFD from a literal one standing at the cursor, which adds a chunk
boundary without drift.

**Two consequences for this change, both live:**

1. Its Tier 3 edit is on the **identity path** — the path this change leaves in place when
   `sourceNormalize` is unset. So a normalizing tokenizer used without `sourceNormalize` now
   reaches a _corrected_ Tier 3, which changes where its parts land relative to the numbers
   recorded in "Phase 1 evidence" below. Those numbers were measured before that fix.
2. That change could not run the gte-small leg — `@huggingface/transformers` is not a
   devDependency, and re-adding it is task 4.2 here. **This change therefore owns verifying
   the corrected Tier 3 against gte-small** (task 4.6). It is a handoff, not a gap that was
   waived.

## Phase 1 evidence (gte-small, 2026-05-25)

`Xenova/gte-small` on `"Hi there. I'm Evän."` decodes per-token to:

```
["[CLS]","hi","there",".","i","'","m","evan",".","[SEP]"]
```

Fixtures run at `chunkSize: 4` against two helpers — `gteSmallSplitterNaive` (no
filtering) and `gteSmallSplitter` (filters `[CLS]`/`[SEP]`/`[UNK]`):

| Fixture                 | Naive             | Filtered                                                                          |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `"Hi there. I'm Evän."` | throws on `[CLS]` | throws on `"there"` — after `"hi"` silently mis-anchors into the `h` of `"there"` |
| `"CAFÉ"`                | throws on `[CLS]` | throws on `"cafe"` — no lowercase `c` anywhere in source                          |
| `"naïve résumé"`        | throws on `[CLS]` | **passes** — `n`→0 and `r`→6 happen to be correct                                 |
| `"こんにちは world"`    | throws on `[CLS]` | throws on `"##ん"` — Tier 3 anchors the literal `#`                               |
| `"hello world"`         | throws on `[CLS]` | **passes** — source is already lowercase ASCII                                    |

Eight of ten fail. The two passes are luck: their first anchorable grapheme is unique and
in the right place. Add a second `r` to `"naïve résumé"` and it mis-anchors silently.

Two findings that reshaped the design:

- **`firstAnchorGrapheme` actively harms normalizing splitters.** It assumes any non-U+FFFD
  grapheme is a faithful stand-in for source bytes. True for tiktoken's substitution
  pattern; false for case/accent mutation, and false for the WordPiece `##` literal.
- **`chunk.text` is resliced from source via `start`/`end`**, never concatenated from
  splitter output. For `"naïve résumé"` the splitter returns `["naive","resume"]` yet the
  chunk text comes back correctly accented. The risk surface is anchor _positions_ only,
  not the text payload.

## Why the hybrid cursor was reverted

The attempt: keep length-based `end`, but compute the cursor from an anchor walk through
the part's graphemes. It broke `tiktoken` on `"Hindi: नमस्ते दुनिया"`:

1. tiktoken emits `" �"` — source span 2 (space + first byte of ु).
2. The anchor walk finds only the space, so the cursor advances by 1.
3. The length-based cursor would have advanced by 2, landing on `ु`.
4. The next part (precomposed `ु`) runs `startsWith` at the under-advanced cursor, matches
   whitespace, and falls through to a wrong anchor.

The walk **undershoots** whenever the source span equals the decoded length but only some
of those code units are anchorable. Conclusion: detect the splitter's mode rather than
impose one universal cursor. Any replacement must pass both this fixture and the
gte-small set.

## Known production workaround

`nearform/joyce` lowercases the input before `split` and strips `##` and special tokens
from decoded output, neutralizing modes 2 and 3 from the splitter side. It costs the
caller a separate position lookup against un-lowercased text. Acceptable for a one-off
integration; not a posture for a RAG-first library.

## What the anchoring machinery actually rests on

A review of the whole anchoring design (2026-08-20), to keep this change aimed at the right
component:

- **The anchor _unit_ is not where the risk is.** `Intl.Segmenter` is reached only from Tier 3.
  Swapping `firstAnchorGrapheme` for a one-line code-point regex (`/[^�\p{M}]/u`) produced
  **identical output across 432 scenarios** — 4 corpora including an emoji/ZWJ/skin-tone/
  Devanagari-cluster corpus, x 3 sizes x 2 strategies x 3 chunk sizes x 2 overlaps x 3
  splitters — and passed all 111 `split.test.js` tests. Instrumented over 31,935 Tier 3
  anchorings (emoji + Devanagari, 100KB, tiktoken), the segmenter returned a multi-code-point
  cluster **zero times**. Cluster anchoring is strictly more precise in principle (a part whose
  anchorable content starts with `क्ष` will skip a decoy bare `क` that a code-point anchor
  latches onto), but nothing in the matrix exercises it, and it costs ~31% of the hottest Tier
  3 row (108ms vs 75ms per 100KB Devanagari). Implication for this change: do not assume
  cluster anchoring is protecting correctness today, and do watch per-part cost — Tier 3 is hot
  enough that a normalized-comparison anchor can regress it measurably.
- **The risk is the length-based advance.** `end = start + part.length` is the single assumption
  that produces all three failure modes above. Notably the published library did _not_ make it:
  its `findMatches` derived each span by matching the part's characters into the source
  (`end = lastValidPos + 1`), so it was structurally immune to length ≠ span — while being
  catastrophically lossy in every other respect (1,179,904 code units unattributable across 186
  of 270 benchmark scenarios). The lesson is not to go back, but that a fix here should attack
  the span derivation, which is what `sourceNormalize` plus a normalized-comparison Tier 3
  does.
- **Closed: letting callers supply offsets.** A splitter contract carrying positions
  (`{text, start, end}` parts, as the benchmark's own tiktoken byte-prefix reference computes)
  would dissolve the anchoring problem for callers who have offsets. Ruled out — the callers
  this library serves cannot supply them. Recorded so it is not re-proposed; anchoring stays a
  reconstruction problem.

## Follow-up model coverage

Once a fix lands, broaden fixtures to `Xenova/bge-small-en-v1.5` (similar normalizer),
`Xenova/all-MiniLM-L6-v2` (popular default), and `Xenova/multilingual-e5-small` (wider
Unicode).
