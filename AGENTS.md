# AGENTS.md

Notes for AI agents (and humans) working in this repo.

## Write short

This file, the README, and OpenSpec artifacts are all too long, and length is actively costing
readers. When you touch any of them: lead with the claim, keep a measurement only where it
changes a decision, and **tighten what you edit instead of appending to it**. One sentence of
breadcrumb beats a paragraph of rationale. Same for replies in chat.

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
- `anchorParts` normalizes each returned element through `normalizePart`, then
  either uses the offset the splitter reported or calls `locatePart` to infer
  one. Both paths share the `end = min(start + length, input.length)`
  computation and the cursor advance, which is what keeps coverage identical
  across a mixture of the two. **A reported offset never reaches the tiers**,
  so every limitation below is a bare-string-splitter limitation.
- `normalizePart` validates a reported offset for _possibility_, not
  correctness — integer, in range, not behind the cursor. It deliberately does
  **not** compare `text` against the source at `start`: a byte-mutating
  tokenizer legitimately returns text differing from the span it consumed, so
  rejecting a mismatch would exclude the primary use case.
- `locatePart` runs the three-tier locate per splitter part:
  `startsWith(splitPart, cursor)` → `indexOf(splitPart, cursor)` →
  the anchor-grapheme search. Tier 3 is the safety net for byte-mutating
  splitters; tiers 1 and 2 are the perf-critical happy paths. The old
  `findGrapheme` helper (`slice` + `Intl.Segmenter`) was replaced because
  it was O(n²) on byte-dropping splitters; `indexOf` is safe in tier 3
  because anchor graphemes (filtered by `firstAnchorGrapheme`) never
  start with a low surrogate or combining mark.
- **Tier 3: verify the candidate, and anchor the part's left edge.** Two separate pieces of
  arithmetic, both load-bearing, both easy to mistake for noise.

  `firstAnchorGrapheme` returns `{ segment, offset }`, and tier 3 computes
  `indexOf(segment, cursor + offset) - offset`. Without the `- offset`, a part 3 code units wide
  whose anchor sits 1 unit in gets `start` at the match and `end` at `start + 3` — shifted right
  by one, cursor overshooting by one. Searching from `cursor + offset` is what keeps the
  corrected `start` at or after the cursor. Each half is pinned by its own test and neither
  covers both: "anchors a mixed part at its left edge" and "drops unanchorable parts without
  dropping mixed ones" (whose `[1,4)` expectation looks wrong until you read this) pin the
  subtraction; "searches for the anchor grapheme forward of the part's left edge" pins the search
  start, which needs its own case because dropping it breaks coverage silently rather than
  throwing — the whole suite once stayed green without it.

  The first occurrence is only a candidate, because the span a splitter dropped can contain the
  same grapheme. `skeletonAligns` rejects an offset unless every code unit the splitter could not
  have invented lines up with the source there, and the search walks forward on rejection.
  **Do not apply this to tier 2** — a verbatim hit aligns at every position by construction, so
  the check is vacuous there.

- **Tier 2 is skipped for every part containing U+FFFD**, regardless of
  the source. For a source with no U+FFFD this is a provable equivalence:
  the part is not a substring, so the search could only scan to
  end-of-input and return `-1`. For a source that _does_ contain one it is
  a deliberate correctness choice, not an optimization — U+FFFD is a
  character the splitter invented, so a verbatim hit on it carries no
  information about where the part came from, and acting on such a hit
  strands the cursor past real source. The earlier version gated the skip
  on `input.includes(REPLACEMENT_CHAR)`, which re-enabled tier 2 exactly
  when it was least trustworthy; that probe is gone. `firstAnchorGrapheme`
  likewise returns `null` immediately for a part with no non-replacement
  code unit instead of segmenting it.
- **Tier 1 is deliberately unguarded and cannot be fixed the same way.**
  At the cursor, a manufactured bare U+FFFD is byte-identical to a literal
  one, so a literal U+FFFD standing there may claim a manufactured part.
  Cost is one extra chunk boundary and no drift, since both are one code
  unit wide. Do not "fix" this by probing the source — that is what the
  removed disjunct did.
- **Linearity is pinned by two scaling regressions**, under "anchoring cost" in
  [test/split.test.js](test/split.test.js): one for a clean source, one for a source containing
  U+FFFD. Both measure an 8x size span against a threshold of 16 — a 2x span does not separate
  linear from quadratic at sizes the suite can afford. Do not weaken either to "fix" a slow
  machine; raise the base size instead. They bite: the U+FFFD one measures 42x on a tree without
  the tier 2 skip. Three separate quadratics have been removed from this function, all of them
  from putting a search inside the per-part loop.

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
`chunkOverlap`); the last chunk's `end` equals the **total source length**.
For an array input that total is the sum of the element lengths, not the
array's own `length` — positions index the elements concatenated with no
separator. The only place coverage isn't full is code units before
`chunks[0].start` (no previous chunk to extend into). **Don't break this**
— downstream RAG/citation use cases rely on it.

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
`src/` via the `main` field. The two graphs are independent. Don't try to "fix" the paths.

Verified by hand — `npm pack`, install the tarball into a scratch project, then import by
package name — under `moduleResolution: nodenext` and `bundler`, plus runtime ESM and
`require()`. There is **no automated test** for this; see "Considered and deliberately not
taken" below.

### JSDoc gotchas under `strict` + `checkJs`

- `// @ts-expect-error <reason>` works in `.js` files when `checkJs` is on. Use it for
  tests that intentionally pass bad arguments (see [test/get-chunk.test.js](test/get-chunk.test.js),
  [test/split.test.js](test/split.test.js)).
- Empty array literals need an explicit annotation: `/** @type {string[]} */ const x = []`.
  Otherwise strict mode flags them as implicit `any[]`.
- Arrow helpers like `text => text.split('')` need `/** @param {string} text */` —
  parameters can't be inferred from usage in strict mode.
- For type-predicate assertion functions, JSDoc supports the full TS syntax:
  `@returns {asserts x is keyof typeof Foo}`. Nothing in `src/` needs it today —
  `splitValidate` checks `chunkStrategy` with `Set` membership instead.
- **`@overload` does not work on an arrow function.** It applies to `function`
  declarations, so on `export const split = (…) => {…}` it is silently ignored and every
  call keeps the widest signature — you get no error, just no narrowing. (Nor do multiple
  `@overload` tags in one comment block work; TS wants a separate block each.) Since this
  repo prefers arrows, `split` and `getChunk` instead declare a `@typedef` of call
  signatures and export a cast of a private `…Impl` arrow. The cast is load-bearing: the
  implementation returns the union form, which is not assignable to the narrowed
  signatures.

### Overload sets keep a union signature last

`SplitFn` in [src/split.js](src/split.js) and `GetChunkFn` in
[src/get-chunk.js](src/get-chunk.js) each end with a `string|string[]` signature after the
two narrow ones. It looks redundant and it is not: with only the narrow signatures, a caller
holding a `string | string[]` variable matches neither and stops compiling — which is what
makes narrowing a breaking change rather than a free one. Keeping the union last means
`chunk.text` narrows for callers who pass a literal type _and_ union-typed call sites still
resolve. Verified against a probe covering both narrowed forms, union input, a bare
`Chunk[]` annotation, and assignment to the pre-change function type. Don't "simplify" the
third signature away.

### Don't reintroduce removed tooling

`commitlint`, `husky`, `lint-staged`, `typescript-eslint`, `ts-node`, and `globals` were
deliberately removed. The `prepare` script was removed alongside husky. If you find
yourself wanting any of them back, ask first.

`@changesets/cli` and `@changesets/changelog-github` are the exception — they were added
deliberately and drive releases. See docs/CONTRIBUTING.md, "Releasing with Changesets".

Three CI/automation files were removed for reasons that aren't recoverable from the diff,
so they're recorded here rather than re-added as "missing":

- `.github/workflows/notify-release.yml` — superseded by Changesets.
  `changesets/action/publish` creates the GitHub release and git tag itself, so a separate
  notifier was duplicating it.
- `.github/workflows/check-linked-issues.yml` — the linked-issue requirement was dropped
  deliberately. It also ran on `pull_request_target`, so retiring it removed a
  fork-privileged trigger as a bonus.
- `.github/dependabot.yml` — this package has **zero production dependencies**, so the
  bot's value didn't justify the PR noise. `npm run dep:check` (`npx npm-check-updates`)
  covers dev-dependency drift on demand.

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

### The benchmark baseline is downloaded, not installed or vendored

`test/benchmark.js` compares this working copy against published `llm-splitter@0.2.0`. That
release's three dependency-free ESM files are fetched from jsDelivr into `test/.cache/`
(gitignored) on first run, verified against pinned SHA-256 digests, and reused offline after.
A clean clone needs `npm ci` plus network once. Three deliberate consequences:

- **The digests in `BASELINE_FILES` are load-bearing.** The script executes downloaded code, and
  a baseline that can drift measures nothing, so a mismatch is a hard failure. Bumping
  `BASELINE_VERSION` means regenerating them (command is in the docstring above the constant).
- **Don't "simplify" it into a devDependency.** An unaliased `npm i -D llm-splitter` is the trap:
  it works today only because this package has no `exports` map (see "Considered and deliberately
  not taken" — declined, but one edit away). Add one and Node's self-reference makes the baseline
  `src/index.js`, so the benchmark reports zero differences against itself. Today the working copy
  comes in by relative path and the baseline by cache URL, so neither resolves by package name.
- **Excluded from `check:types` and `npm run check`.** The baseline import resolves at runtime
  through a cache URL, so `tsc` has no static path; the run also takes minutes and needs network.
  `test/.cache/` is in the eslint and prettier ignore lists too — it's someone else's build output.

Behind a corporate proxy the first run fails with `fetch failed`: Node's `fetch` ignores
`HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is in the environment, and setting it from inside the
script does not work because undici reads it at bootstrap.

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

- **The three residual anchoring defects have a remedy, not a fix.** `splitter-reported-positions`
  shipped the way around them: a splitter may return `{ text, start }`, and a reported offset skips
  all three tiers, so no inference happens for that part. `delimiterSplitter` covers the common
  delimiter case. Measured over the decoy corpus, `delimiterSplitter` scores 0 mis-anchored where
  bare-string splitters score 2,424 / 5,140 / 1,566 by delimiter shape.

  The search itself is unchanged and still gets these three wrong. Keep them apart — a single
  number (395) used to conflate the first two:

  1. **Tier 2 takes the first verbatim match — 489 of 20,000 (2.4%), and _not_ a U+FFFD bug.**
     `split("a....", { splitter: (t) => t.split("...").filter(Boolean) })` puts the `"."` at 1;
     it is at 4. Plain ASCII, real splitter, and it predates `chore/rewrite`. Largest of the three.
     Candidate verification cannot touch it: a verbatim hit aligns at every position by construction.
  2. **Tier 3 candidate a one-character skeleton cannot rule out — 158 of 15,986.** When a part
     carries one non-U+FFFD code unit and that unit _is_ the anchor grapheme, verification
     re-tests what already matched. 317 of 395 offending parts carry exactly one, 70 carry two.
  3. **Tier 1 manufactured vs literal U+FFFD — 7 oracle residual.** Provably not fixable from the
     text: byte-identical at the same position with opposite correct answers, per
     [the archived Decision 4](openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md).

  **Measured dead ends, so none is re-proposed as an improvement to the search:** one-part
  lookahead fixes 0 of 124, rightmost-greedy is worse (578 vs 489), skeleton verification on tier 2
  is vacuous, and a global alignment search is ambiguous (`"a...."` admits four valid alignments).
  This is why the shipped answer routes around the search instead of refining it.

**Shipped and archived** — detail lives in each change directory, not here:

- `2026-08-21-decoy-grapheme-anchoring` — tier 3 now verifies each candidate (`skeletonAligns`).
  Worth reading for one lesson: it was filed rather than shipped for a round because a
  `() => parts` stub scored the fix at "906 → 395, a mitigation". Against a **real** splitter it
  was 10.5% → 0%. Score a splitter-facing change with a real splitter, or the corpus answers a
  different question.
- `2026-08-21-literal-replacement-char-anchoring` — tier 2 skipped for every U+FFFD-bearing part,
  plus the tier 3 left-edge offset. `design.md` → "Reproducing the measurements" is a reusable
  differential harness.
- `2026-08-20-anchor-scan-short-circuit` — removed the O(n²) tier 2 scan. Its linearity carve-out
  for U+FFFD-bearing sources was later closed (40x → 7x for an 8x span) and is now a guarantee in
  `multibyte-anchoring`. `tasks.md` § 6 holds a conditional follow-up on a tier-2 distance bound.

### Considered and deliberately not taken

Surfaced during the pre-`0.3.0` review and declined on the merits — not parked pending a
version. Recorded so none of them is re-proposed as an oversight. Each says what would
change our mind, which is the only thing that should reopen it.

- **No `exports` map, by choice — we prefer a soft contract.** `main: src/index.js` +
  `types: dist/index.d.ts` already resolves correctly with no `exports` field — verified
  against a packed tarball under `moduleResolution: nodenext` _and_ `bundler`, plus runtime
  ESM and `require()`. So the `src`/`dist` skew is **not** a reason to add one; the only
  thing `exports` buys is encapsulation, and we would rather document the supported surface
  than have the resolver enforce it. Deep paths like
  `import('llm-splitter/src/split.js')` do resolve today; that is understood and accepted,
  not an oversight. `split()` and `getChunk()` from the package root are what the README and
  `openspec/specs/` describe, and that is the contract — reaching past it is
  use-at-your-own-risk rather than something the package prevents.

  What would change our mind: an actual report of someone depending on an internal path in
  a way that blocks a refactor. Hard enforcement is cheap to add at that point and needs no
  redesign. The minimal form, kept here so the option stays one edit away:

  ```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./src/index.js" },
    "./package.json": "./package.json"
  }
  ```

  Keep `main`/`types` alongside it for legacy resolvers. The `./package.json` entry is what
  keeps tooling that reads the manifest working. Measured: deep imports start returning
  `ERR_PACKAGE_PATH_NOT_EXPORTED` and everything else stays green. Note this is a breaking
  change for any deep importer, so it wants its own minor and a changeset that says so.

- **No packaged-consumer test.** Nothing in CI installs a packed tarball and imports the
  package by name, so the resolution model above is verified only by hand. Considered and
  declined for `0.3.0` as disproportionate for a package this shape. Worth reconsidering if
  `exports` lands, since that is exactly the kind of change that breaks resolution silently.

- **No `engines` field, by choice.** Raised in review and declined — the constraint causes
  more friction than it prevents. Recorded so it isn't re-proposed as an oversight.
