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
npx changeset        # add a changeset for a user-facing change
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
- **Tier 2 is skipped when it provably cannot match**: a part containing
  U+FFFD is not a substring of a source containing none, so the search
  could only scan to end-of-input and return `-1`. `anchorParts` probes
  the source for U+FFFD once per call; a source that _does_ contain one
  disables the skip. `firstAnchorGrapheme` likewise returns `null`
  immediately for a part with no non-replacement code unit instead of
  segmenting it. **The quadratic has now moved twice** — out of
  `findGrapheme`, then out of the tier 2 failure branch — so it is pinned
  by a scaling regression ("anchoring cost" → "grows linearly with input
  size" in [test/split.test.js](test/split.test.js)) rather than trusted
  to stay gone. That test measures an 8x size span against a threshold of
  16; a 2x span does not separate linear from quadratic at sizes the suite
  can afford. Do not weaken it to "fix" a slow machine — raise the base
  size instead.
- After all chunks emit, a forward-extension pass sets
  `chunk[i].end = chunk[i+1].start` (and the last chunk to total input
  length). This enforces the **coverage invariant**.

**`Intl.Segmenter` is not the architecture.** It appears in one function
(`firstAnchorGrapheme`), reached only from tier 3. Everything else — tiers 1
and 2, chunk assembly, coverage, `chunkSize` — counts UTF-16 code units, and
chunk boundaries carry no grapheme or code-point integrity guarantee (the
default `text.split('')` splitter emits lone surrogates for astral characters;
see `multibyte-anchoring` → "Anchoring positions parts, it does not police
boundaries"). Measured, cluster anchoring is inert on every splitter in the
matrix: a one-line code-point regex is output-identical across 432 scenarios,
and the segmenter returned a multi-code-point cluster 0 times in 31,935 tier 3
anchorings, at ~31% of the hottest tier 3 row. Keep it as a correctness margin
if you like, but don't treat it as load-bearing and **don't reintroduce it into
tiers 1-2** — that is where both quadratics came from. The load-bearing
assumption is `end = start + part.length` (decoded length equals source span),
which is what `tokenizer-length-inflation` exists to address; evidence in that
change's `research.md` → "What the anchoring machinery actually rests on".

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

`@changesets/cli` and `@changesets/changelog-github` are the exception — they were added
deliberately and drive releases. See docs/CONTRIBUTING.md, "Releasing with Changesets".

### `GITHUB_TOKEN` in the release workflow has two unrelated consumers

`changesets/action@v2` deliberately stopped reading the `GITHUB_TOKEN` **env var** — it
takes a `github-token` **input** instead. But `@changesets/changelog-github` runs inside
`changeset version` as a library, not as part of the action, and still reads
`process.env.GITHUB_TOKEN` to resolve each changeset's commit into a PR link over the
GraphQL API. It throws outright when the var is missing, so the `version` job keeps an
explicit `env: GITHUB_TOKEN`. Deleting it as "v1 leftover" makes the release PR stop
opening.

This fails closed and it fails invisibly in local dry runs: an **uncommitted** changeset
has no commit for the generator to look up, so it skips the API entirely and
`changeset version` succeeds on a dirty tree while the same changeset fails in CI. To
exercise the real path you have to commit the changeset first.

### `prepack` is what puts `dist/` in the tarball

`files` ships `src` and `dist`, but nothing else builds `dist/` at publish time —
`prepack` (`npm run build`) is the only thing standing between a release and a tarball
whose `types` entry points at a file that isn't there. `changeset pack` runs `npm pack`,
which fires it; the release workflow's `pack` job also runs `npm run build` explicitly.
Don't drop `prepack` on the grounds that CI already builds.

### Demo (`index.html`) imports from `src/`, not `dist/`

`index.html` does `import { split } from './src/index.js'`. The
[demo-page workflow](.github/workflows/demo-page.yml) copies `src/` (not `dist/`) into
`demo-public/`. There is no build step for the demo.

### Synthetic regression tests model shapes; real tokenizer fixtures catch the rest

A first hybrid-cursor attempt for tokenizer length inflation satisfied the
synthetic drift regression but broke `tiktoken` on a Devanagari fixture.
Don't take "synthetic passes" as license to ship; run any
tokenizer-affecting change against the multibyte fixtures **and** the real
gte-small ones. Both the synthetic repro and the gte-small fixture code
live in the change's `design.md` → "Acceptance criteria", not the test
suite — see "Open work / future".

## Spec-driven workflow (OpenSpec)

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) to track _what the
library guarantees today_ vs _what we're going to change next_. See
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full workflow.

- `openspec/specs/` — the current behavioral contract as capabilities
  (`chunking`, `chunk-coverage`, `multibyte-anchoring`, `chunk-extraction`).
  The README stays the human narrative; specs are the structured source of truth.
- `openspec/changes/` — proposed work (proposal + design + spec deltas + tasks).
- Drive future work from Claude Code with the `/opsx:*` slash commands
  (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`); see docs/CONTRIBUTING.md.
  Inspect/validate via the CLI: `openspec validate --all --strict`.

## Open work / future

- **Tokenizer length inflation** — normalizing embedding tokenizers (`gte-small` and
  friends) mis-anchor or throw. Everything lives in
  [openspec/changes/tokenizer-length-inflation/](openspec/changes/tokenizer-length-inflation/):
  `proposal.md`, `design.md` (decisions, plus both failing test suites under "Acceptance
  criteria"), `research.md` (the gte-small evidence and the reverted hybrid-cursor trace),
  spec deltas, and a phased `tasks.md`. Nothing for it lives in `test/split.test.js` — the
  suite is unconditional and green. When it ships, run
  `openspec archive tokenizer-length-inflation` to merge the deltas into `openspec/specs/`.

- **Quadratic tier-2 anchor scan** — shipped and archived. `indexOf(splitPart, cursor)` used to
  scan to end of input for every part that isn't verbatim in the source, making
  `character`-strategy splits O(n²) on tokenizer output; fixed by the tier 2 skip described in
  the algorithm map, and now part of the `multibyte-anchoring` contract. Background lives in
  [openspec/changes/archive/2026-08-20-anchor-scan-short-circuit/](openspec/changes/archive/2026-08-20-anchor-scan-short-circuit/) —
  `design.md` carries the tier instrumentation, the measured tier-2 reach data, the rationale
  for rejecting a distance bound, and the measurements behind the regression's constants
  (including the conditional follow-up in `tasks.md` § 6 for revisiting a tier-2 distance bound
  if a caller ever reports a splitter that legitimately drops long spans).
  `tokenizer-length-inflation` also edits `anchorParts` (the tier 3 anchor step) and rebases on
  this.
