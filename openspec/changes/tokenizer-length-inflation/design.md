## Context

`anchorParts` in [src/split.js](../../../src/split.js) uses a three-tier locate per part:
`startsWith(part, cursor)` → `indexOf(part, cursor)` → `indexOf(firstAnchorGrapheme(part), cursor)`,
with the cursor advanced by `part.length`. Tiers 1–2 are the perf-critical happy paths for
byte-preserving splitters; Tier 3 is the safety net for byte-mutating ones (tiktoken emits
one U+FFFD per undecodable byte, so length still equals source span).

Phase 1 wired `@huggingface/transformers` v4 + `Xenova/gte-small` into the suite as
regression fixtures and produced concrete evidence (full writeup in
[research.md](./research.md)). Key facts that constrain the design:

- For `"Hi there. I'm Evän."`, `gte-small` decodes to
  `["[CLS]","hi","there",".","i","'","m","evan",".","[SEP]"]`.
- Three distinct failure modes exist: (1) length inflation (`"##ん"` len 3 vs span 1; `[CLS]`
  len 5 vs span 0), (2) **equal-length content mutation** (`"Hi"`→`"hi"`, `"Evän"`→`"evan"`) —
  the most common gte-small case, (3) zero-span control tokens (`[CLS]`/`[SEP]`/`[UNK]`).
- Tier 3 `firstAnchorGrapheme` _actively harms_ normalizing splitters: it anchors `##ん` on
  the literal `#` (absent from source) and silently mis-anchors `"hi"` into the `h` of
  `"there"`. Silent mis-anchoring is usually masked by a later cascading throw, but not always.
- `chunk.text` is resliced from source via `start`/`end`, so the risk surface is entirely the
  anchor _positions_, not the text payload.

## Goals / Non-Goals

**Goals:**

- Correctly position parts from normalizing tokenizers when the caller declares the
  normalization via an opt-in `sourceNormalize`.
- Zero behavior change and zero perf regression for length-preserving splitters (char,
  whitespace, sentence/line, tiktoken).
- Turn both suites parked in "Acceptance criteria" — the synthetic drift regression and the
  gte-small fixtures — into asserting tests in `test/split.test.js`.

**Non-Goals:**

- Auto-detecting the tokenizer's normalization pipeline (rejected — see Decisions).
- Inverting arbitrary lossy normalization; if the caller's `sourceNormalize` cannot map a
  part to a source window, throwing loudly remains correct.
- Broadening fixtures to other models (`bge-small`, `all-MiniLM-L6-v2`,
  `multilingual-e5-small`) — tracked as follow-up once the core fix lands.
- Changing the anchor _unit_. Grapheme-cluster anchoring is measured inert on every splitter in
  the matrix (0 multi-code-point anchors in 31,935 Tier 3 anchorings; a code-point regex is
  output-identical across 432 scenarios) — see `research.md`, "What the anchoring machinery
  actually rests on". It is neither the cause of these failures nor part of the fix. Leave it
  alone here; it is a separable simplification worth ~31% of the hottest Tier 3 row if it is
  ever wanted.
- Accepting positions from the splitter. Ruled out — these callers cannot supply offsets, so
  anchoring stays a reconstruction problem (`research.md`, same section).

## Decisions

**Prior attempt (reverted): hybrid cursor.** Keep length-based `end`, compute the cursor
from an anchor walk through the part's graphemes. It broke tiktoken on `"Hindi: नमस्ते दुनिया"`:
tiktoken emits `" �"` (source span 2), the anchor walk found only the space and advanced by
1, under-advancing the cursor so the next precomposed grapheme mis-anchored. Conclusion: the
fix must _detect_ the splitter's mode, not impose one universal cursor.

**Directions considered**, cheapest first:

- **Per-part inflation detection** — after locating `start`, compare the part's code points
  against source until they diverge, treating U+FFFD as a wildcard, and take the divergence
  point as the next cursor. Local and needs no global classification, but insufficient on
  its own: it locates length inflation and zero-span tokens, not equal-length mutation,
  which [research.md](./research.md) shows is the most common gte-small failure.
- **A `splitterKind` enum** (`"exact" | "tiktoken" | "normalizing"`) — explicit and
  heuristic-free, but adds API surface and pushes classification onto users who often don't
  know what their model's tokenizer does at decode time.
- **Two-pass fallback on throw** — catch the anchoring failure and retry that group with
  different cursor logic. Handles the loud case only: it misses silent mis-anchoring
  entirely, doubles the work on failure, and retries genuine splitter bugs that should fail.
- **Per-call classifier** — infer the splitter's mode from the first few parts, then pick a
  cursor strategy. Awkward in the streaming loop and strictly worse than per-part inflation
  detection, which decides the same thing locally.
- **Punt and document** — lock in current behavior with a clear "unsupported" notice. The
  posture this change replaces.

**Chosen: opt-in `sourceNormalize` + a normalized Tier 3 that derives a source span + a loud,
actionable failure for parts that cannot be located.**

1. **`sourceNormalize` option** (default identity). Cheaper than a `splitterKind` enum and
   needs no classification heuristics. Callers declare intent explicitly:
   `sourceNormalize: (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")`.
2. **Normalized-comparison Tier 3, returning a span.** When `sourceNormalize` is set, replace
   `indexOf(firstAnchorGrapheme(part), cursor)` with: walk source from `cursor`, find the
   first `i` where `normalize(source[i..])` starts with `normalize(part)`, then take the
   **shortest** `j > i` such that `normalize(source[i..j]) === normalize(part)`. Set
   `start = i`, `end = j`, and advance the cursor to `j`. This is the only approach that
   handles equal-length content mutation, and returning `j` rather than
   `start + part.length` is what handles inflation — see "Settled: the scan returns a span"
   below.
3. **Control tokens are the caller's to remove; the library's job is to fail loudly.** An
   earlier draft of this decision read "parts with no source-anchorable graphemes (`[CLS]`
   etc.)", which is factually wrong and worth correcting explicitly: `[CLS]` _is_ anchorable.
   `firstAnchorGrapheme("[CLS]")` returns `"["`, so against a source containing any literal
   `[` it anchors there — verified, source `"a [b] ん"` with part `[CLS]` anchors at
   `start = 2` with no error. Nothing in a part distinguishes a control token from ordinary
   bracketed source text, so in-library detection would be a guess dressed as a check.

   What the span scan in decision 2 _does_ give us is a sound signal: a part whose normalized
   form does not occur at or after the cursor is unlocatable, full stop. Control tokens land
   there, and so do genuinely mutating splitters — which the `multibyte-anchoring` contract
   already says must fail loudly. So: throw, with a message that names the likely cause and
   the fix ("looks like a special token — filter it in your splitter"). That turns today's
   silent mis-anchor into a loud, actionable failure, which is the real improvement available
   here.

   Callers strip special tokens splitter-side, which is what `gteSmallSplitter` already does
   in "Acceptance criteria" §2 and what the `nearform/joyce` workaround does in production.
   `gteSmallSplitterNaive` therefore stays unsupported by design — it is a fixture that
   documents the failure, not a target. If a caller later shows that is not enough, the only
   sound form is an explicit declaration (`specialTokens: string[]`); note that
   `sourceNormalize` + `specialTokens` is most of the API surface the `splitterKind` enum was
   rejected for, so prefer the filter until then.

4. **Coverage invariant preserved.** `end` still derives so adjacent chunks meet; the
   `chunk-coverage` contract is unchanged.

**Settled: the scan returns a span, and the identity path does not change.** This closes the
question this section used to leave open ("is per-part inflation detection still needed?") and
is a prerequisite for task 3.2 — it decides what the cursor advances by, which decisions 2 and
4 previously left unstated.

- **The span is derived, not assumed.** Locating `start` alone is not enough: `"##ん"` decodes
  to length 3 over a source span of 1, so keeping `end = start + part.length` still overshoots
  by 2 and the next part mis-anchors. Taking the shortest `j` with
  `normalize(source[i..j]) === normalize(part)` yields the true span, and all three failure
  modes — inflation, equal-length mutation, zero-span — fall out of that one derivation.
  Per-part inflation detection is therefore **not** needed as a separate mechanism.
- **The identity path stays byte-identical.** Deriving spans when no `sourceNormalize` is
  supplied would mean imposing one universal cursor, which is exactly what broke tiktoken on
  `"Hindi: नमस्ते दुनिया"` in the reverted hybrid-cursor attempt. Consequence for the fixtures:
  the drift splitter in "Acceptance criteria" §1 must supply a `sourceNormalize` to be an
  asserting test. Without one it documents the unsupported default, and task 4.1 asserts the
  opt-in form.
- **Bound the scan window.** This is a per-part forward scan over the source — structurally the
  same shape as the Tier 2 scan that made `character`-strategy splits quadratic (100KB
  Devanagari: 1976ms; see the archived `anchor-scan-short-circuit`). A handful of unlocatable
  parts per document would reintroduce that curve, on a path that also allocates normalized
  substrings. Cap the window at a small multiple of the part's normalized length, fail past it
  per decision 3, and carry a scaling regression in the shape of the one that change left
  behind. Do not ship this without measuring it.

## Risks / Trade-offs

- **Correctness vs tiktoken.** The normalized path must not perturb tiktoken/Devanagari.
  Mitigation: normalized Tier 3 only engages when `sourceNormalize` is non-identity; default
  path is byte-identical to today. Re-run the multibyte and gte-small fixtures and the
  Devanagari case explicitly.
- **Cost.** Normalized comparison is O(window) and allocates per Tier 3 fallback. Mitigation:
  Tiers 1–2 (99.6% of parts on real corpora) are untouched; bound the forward search window.
- **Lossy normalization ambiguity.** If `normalize(part)` matches multiple source windows,
  first-match-from-cursor is the rule (same as `indexOf` today); document it.
- **User burden.** Callers must supply a `sourceNormalize` matching their tokenizer. Accepted:
  explicit and debuggable beats a hidden auto-classifier that silently guesses wrong.
- **Synthetic vs real divergence.** A synthetic drift test once passed while tiktoken broke;
  gate the change on the real gte-small fixtures, not just the synthetic case below.

## Acceptance criteria

Both suites below are parked here rather than in `test/split.test.js`: they fail today, and
neither a permanently-failing case nor an env-gated one belongs in a suite that should be
green and unconditional. Tasks 4.1 and 4.2 move them back in as asserting tests when the fix
lands. A complete fix satisfies **both**, and regresses neither tiktoken nor the multibyte
fixtures — especially the Devanagari case `"Hindi: नमस्ते दुनिया"` that broke the hybrid-cursor
attempt.

### 1. Synthetic drift splitter

A splitter that appends a U+FFFD byte to every character, so each part's decoded length (2)
exceeds its source span (1). Today this throws at the second part: `end`/`cursor` advance by
`part.length`, so after `"a�"` the cursor sits at 2, while the anchor `b` lives at source
position 1 — behind the cursor, so it can't be found.

```js
const driftSplitter = (text) => text.split("").map((ch) => ch + "�");
// For "abc" the splitter yields ["a�", "b�", "c�"].
const result = split("abc", { chunkSize: 3, splitter: driftSplitter });
assert.deepStrictEqual(result, [{ text: "abc", start: 0, end: 3 }]);
```

Why it matters: tiktoken keeps 1:1 byte↔char (one U+FFFD per undecodable byte), so the
length-based cursor is exact for it. A fix must therefore _detect_ inflation rather than
switch cursor algorithms wholesale — the reverted hybrid-cursor attempt undershot tiktoken
and broke the Devanagari fixture.

### 2. Real gte-small fixtures

Needs `@huggingface/transformers` as a dev dependency and downloads `Xenova/gte-small`
(~23 MB) on first run. These previously lived in `test/split.test.js` behind a `B7_TEST=1`
env gate; the gate and the fixtures were removed so the suite has no conditional paths.
[research.md](./research.md) records which failure mode each fixture exercises and what each
throws today.

```js
import { AutoTokenizer } from "@huggingface/transformers";

const tok = await AutoTokenizer.from_pretrained("Xenova/gte-small");

// Encode + decode-each-token, nothing filtered — includes [CLS]/[SEP]/[UNK].
const gteSmallSplitterNaive = (text) =>
  tok.encode(text).map((id) => tok.decode([id]));

// Same, but drops control tokens. Keeps `##` prefixes and the lowercase /
// accent-stripped output: nearform/joyce's workaround also pre-lowercases the
// input and strips `##`, deliberately not done here so the fixtures expose
// what the library handles unaided.
const gteSmallSplitter = (text) =>
  tok
    .encode(text)
    .map((id) => tok.decode([id]))
    .filter((t) => t !== "[CLS]" && t !== "[SEP]" && t !== "[UNK]");

const fixtures = [
  { label: "uppercase + apostrophe + accent", input: "Hi there. I'm Evän." },
  { label: "uppercase + accent", input: "CAFÉ" },
  { label: "accent-only", input: "naïve résumé" },
  { label: "CJK + ASCII", input: "こんにちは world" },
  { label: "pure-ASCII control", input: "hello world" },
];

for (const { label, input } of fixtures) {
  for (const [kind, splitter] of [
    ["naive", gteSmallSplitterNaive],
    ["filtered", gteSmallSplitter],
  ]) {
    it(`gte-small (${kind}): ${label}`, () => {
      const chunks = split(input, { chunkSize: 4, splitter });
      // Coverage-only for now; task 4.2 upgrades these to exact positions.
      for (let i = 0; i < chunks.length - 1; i++) {
        assert.ok(chunks[i].end >= chunks[i + 1].start);
      }
      assert.strictEqual(chunks[chunks.length - 1].end, input.length);
    });
  }
}
```
