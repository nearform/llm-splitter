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

## Follow-up model coverage

Once a fix lands, broaden fixtures to `Xenova/bge-small-en-v1.5` (similar normalizer),
`Xenova/all-MiniLM-L6-v2` (popular default), and `Xenova/multilingual-e5-small` (wider
Unicode).
