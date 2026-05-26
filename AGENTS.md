# AGENTS.md

Notes for AI agents (and humans) working in this repo.

## Architecture in one paragraph

Source is plain JavaScript (`src/*.js`) with **JSDoc type annotations**, not TypeScript.
`tsc` runs in declaration-only mode and emits `dist/*.d.ts` files for publication; no `.js`
transpilation happens. Runtime consumers load `src/index.js` (via `main`); TypeScript
consumers load `dist/index.d.ts` (via `types`). Tests are also plain JS, run with the
built-in `node --test` runner — no ts-node loader.

## Commands

```
npm run lint         # eslint
npm run check:types  # tsc -p tsconfig.check.json  (validates JSDoc on src + test)
npm run check:format # prettier checks
npm test             # node --test
npm run build        # tsc -p tsconfig.json  (emits dist/*.d.ts only)
npm run check        # lint + check:types + test + format check
npm run format       # prettier + eslint --fix

B7_TEST=1 npm test   # also runs the gte-small regression fixtures (downloads
                     # Xenova/gte-small, ~23MB, lazy-loaded inside before()).
                     # Plain `npm test` shows them as skipped.

node tmp-benchmark-rewrite.js
                     # Perf comparison vs the published llm-splitter@0.2.0
                     # at ../llm-splitter/dist/. 90-scenario matrix across
                     # size × strategy × chunkSize × overlap × splitter.
                     # Use this for any algorithm change in src/split.js.
```

`check:types` and `build` use **two different tsconfigs**: `tsconfig.json` builds
declarations from `src/` only; `tsconfig.check.json` extends it, sets `noEmit`, and adds
`test/` to `include`.

## Algorithm map

Core logic is in [src/split.js](src/split.js). High-level orientation:

- `boundaryGroups` builds `Array<{ baseOffset, parts }>`. Paragraph-mode
  trims leading/trailing whitespace before anchoring and uses the
  constant `PARAGRAPH_DELIMITER` (`"\n\n"`) for both the split regex and
  the per-paragraph cursor advance. Character-mode is a single group at
  offset 0.
- `anchorParts` runs a three-tier locate per splitter part:
  `startsWith(splitPart, cursor)` → `indexOf(splitPart, cursor)` →
  `indexOf(firstAnchorGrapheme(splitPart), cursor)`. Tier 3 is the
  safety net for byte-mutating splitters; tiers 1 and 2 are the
  perf-critical happy paths. The old `findGrapheme` helper (`slice` +
  `Intl.Segmenter`) was replaced because it was O(n²) on byte-dropping
  splitters; `indexOf` is safe in tier 3 because anchor graphemes
  (filtered by `firstAnchorGrapheme`) never start with a low surrogate
  or combining mark.
- After all chunks emit, a forward-extension pass sets
  `chunk[i].end = chunk[i+1].start` (and the last chunk to total input
  length). This enforces the **coverage invariant**.

**Coverage contract** (also in the `split()` docstring and the README
"Chunk Coverage and Positions" section): from `chunks[0].start` onward,
every UTF-16 code unit of source appears in exactly one chunk (modulo
`chunkOverlap`); `chunks[chunks.length - 1].end === input.length`. The
only place coverage isn't full is code units before `chunks[0].start`
(no previous chunk to extend into). **Don't break this** — downstream
RAG/citation use cases rely on it.

## Pitfalls

### Use the project's Node version

The default `node` on this machine is **v16**, which is too old for the toolchain
(eslint 10, npm 11, etc.) and will produce baffling errors. Always activate nvm against
the project's `.nvmrc` (`lts/*`) **before** running anything:

```sh
source ~/.nvm/nvm.sh && cd /Users/rye/scm/nf/llm-splitter-rewrite && nvm use
```

`nvm use` only finds `.nvmrc` when the CWD is inside the project, and each new `Bash` tool
invocation starts a fresh shell — so re-source nvm every time, or chain it inline:
`source ~/.nvm/nvm.sh && nvm use 2>/dev/null && <your command>`.

### `dist/` only contains `.d.ts` — that's intentional

`dist/index.d.ts` has lines like `export { ... } from "./split.js"`. Those `.js` strings
look broken (there is no `dist/split.js`), but they're not. TypeScript resolves `.js` in a
`.d.ts` to a sibling `.d.ts` (here: `dist/split.d.ts`); Node runtime resolution uses
`src/` via the `main` field. The two graphs are independent. Don't try to "fix" the paths
— verified working by a packed-tarball consumer test.

### JSDoc gotchas under `strict` + `checkJs`

- `// @ts-expect-error <reason>` works in `.js` files when `checkJs` is on. Use it for
  tests that intentionally pass bad arguments (see [test/get-chunk.test.js](test/get-chunk.test.js),
  [test/split.test.js](test/split.test.js)).
- Empty array literals need an explicit annotation: `/** @type {string[]} */ const x = []`.
  Otherwise strict mode flags them as implicit `any[]`.
- Arrow helpers like `text => text.split('')` need `/** @param {string} text */` —
  parameters can't be inferred from usage in strict mode.
- For type-predicate assertion functions, JSDoc supports the full TS syntax:
  `@returns {asserts x is keyof typeof Foo}`. See `assertChunkStrategy` in
  [src/split.js](src/split.js).

### Don't reintroduce removed tooling

`commitlint`, `husky`, `lint-staged`, `typescript-eslint`, `ts-node`, and `globals` were
deliberately removed. The `prepare` script was removed alongside husky. If you find
yourself wanting any of them back, ask first.

### Demo (`index.html`) imports from `src/`, not `dist/`

`index.html` does `import { split } from './src/index.js'`. The
[demo-page workflow](.github/workflows/demo-page.yml) copies `src/` (not `dist/`) into
`demo-public/`. There is no build step for the demo.

### Verify perf claims with the benchmark, not by reasoning alone

The `findGrapheme` slow path was assumed "fine" until the benchmark
([tmp-benchmark-rewrite.js](tmp-benchmark-rewrite.js)) surfaced a 659x
worst-case slowdown vs. the published library on byte-dropping
splitters. The fix (replace `Intl.Segmenter`-over-slice with `indexOf`)
was obvious in hindsight, but the magnitude wasn't until measured. Run
the bench after any algorithm change.

### Synthetic regression tests model shapes; real tokenizer fixtures catch the rest

A first hybrid-cursor attempt for tokenizer length inflation (B7)
passed the synthetic `it.todo` regression but broke `tiktoken` on a
Devanagari fixture. Don't take "synthetic passes" as license to ship;
also run any tokenizer-affecting change against the multibyte +
`B7_TEST=1` fixtures.

## Open work / future

- [docs/tokenizer-length-inflation.md](docs/tokenizer-length-inflation.md)
  — single open item, internal codename **B7**. Captures the problem
  (HuggingFace embedding models like `gte-small` whose tokenizer
  pipelines normalize during decode), the real-world regression
  fixtures (live in [test/split.test.js](test/split.test.js), gated by
  `B7_TEST=1`), the failed Phase 2 hybrid-cursor attempt, and five
  candidate fix directions with a refined proposal under "Implications
  for Phase 2". Self-contained; can be lifted into a GitHub issue.
