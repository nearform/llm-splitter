# AGENTS.md

Notes for AI agents (and humans) working in this repo.

## Write short

This file, the README, and OpenSpec artifacts are all too long. When you touch any of them:
lead with the claim, keep a measurement only where it changes a decision, and **tighten what
you edit instead of appending to it**. Same for replies in chat.

## Architecture

Source is plain JavaScript (`src/*.js`) with **JSDoc type annotations**, not TypeScript.
`tsc` runs declaration-only and emits `dist/*.d.ts` for publication; no `.js` transpilation.
Runtime consumers load `src/index.js` (via `main`), TypeScript consumers `dist/index.d.ts`
(via `types`). Tests are plain JS run with `node --test`.

## Commands

```
npm run check:lint   # eslint
npm run check:types  # tsc -p tsconfig.check.json  (JSDoc on src + test)
npm run check:format # prettier checks
npm test             # node --test
npm run build        # tsc -p tsconfig.json  (emits dist/*.d.ts only)
npm run check        # lint + check:types + test + format check
npm run format       # prettier + eslint --fix
npx changeset        # add a changeset for a user-facing change
```

`tsconfig.json` builds declarations from `src/` only; `tsconfig.check.json` extends it, sets
`noEmit`, and adds `test/`.

## Algorithm map

Core logic is [src/split.js](src/split.js).

- `boundaryGroups` builds `Array<{ baseOffset, parts }>`. Paragraph mode trims
  leading/trailing whitespace before anchoring and uses `PARAGRAPH_DELIMITER` (`"\n\n"`) for
  both the split and the cursor advance. Character mode is one group at offset 0.
- `anchorParts` normalizes each element through `normalizePart`, then either uses the offset
  the splitter reported or calls `locatePart`. Both paths share the
  `end = min(start + length, input.length)` computation and the cursor advance, which is
  what keeps coverage identical across a mixture of the two. **A reported offset never
  reaches the tiers**, so every limitation below is a bare-string-splitter limitation.
- `normalizePart` validates a reported offset for _possibility_ — integer, in range, not
  behind the cursor. It deliberately does **not** compare `text` against the source at
  `start`: a byte-mutating tokenizer legitimately returns text differing from the span it
  consumed.
- `locatePart` runs three tiers: `startsWith(part, cursor)` → `indexOf(part, cursor)` →
  anchor-grapheme search. Tiers 1-2 are the perf-critical happy paths; tier 3 is the safety
  net for byte-mutating splitters. `indexOf` is safe in tier 3 because anchor graphemes
  (filtered by `firstAnchorGrapheme`) never start with a low surrogate or combining mark.

### Tier 3: two pieces of arithmetic that both matter

`firstAnchorGrapheme` returns `{ segment, offset }` and tier 3 computes
`indexOf(segment, cursor + offset) - offset`.

- **The `- offset`** anchors the part's left edge. Without it a 3-unit part whose anchor sits
  1 unit in gets `start` at the match and `end` at `start + 3` — shifted right by one, cursor
  overshooting by one. Pinned by "anchors a mixed part at its left edge" and "drops
  unanchorable parts without dropping mixed ones" (whose `[1,4)` expectation looks wrong
  until you read this).
- **Searching from `cursor + offset`** keeps the corrected `start` at or after the cursor.
  Pinned by "searches for the anchor grapheme forward of the part's left edge" — it needs its
  own case because dropping it breaks coverage silently rather than throwing.

The first occurrence is only a candidate: the span a splitter dropped can contain the same
grapheme. `skeletonAligns` rejects an offset unless every code unit the splitter could not
have invented lines up with the source there, and the search walks forward on rejection.
**Do not apply this to tier 2** — a verbatim hit aligns at every position by construction.

### U+FFFD

- **Tier 2 is skipped for every part containing U+FFFD**, regardless of the source. For a
  source with no U+FFFD this is a provable equivalence (the part is not a substring, so the
  search could only scan to end-of-input). For a source that _does_ contain one it is a
  correctness choice: U+FFFD is a character the splitter invented, so a verbatim hit on it
  carries no information, and acting on it strands the cursor past real source. Do not gate
  the skip on `input.includes(REPLACEMENT_CHAR)` — that re-enables tier 2 exactly when it is
  least trustworthy.
- **Tier 1 is deliberately unguarded and cannot be fixed the same way.** At the cursor a
  manufactured bare U+FFFD is byte-identical to a literal one. Cost is one extra chunk
  boundary and no drift, since both are one code unit wide.

### Linearity

Two scaling regressions under "anchoring cost" in [test/split.test.js](test/split.test.js) —
one clean source, one containing U+FFFD — measure an 8x size span against a threshold of 16.
A 2x span does not separate linear from quadratic at affordable sizes. Do not weaken either
to "fix" a slow machine; raise the base size instead. The U+FFFD one measures 42x without the
tier 2 skip. Every quadratic this function has had came from putting a search inside the
per-part loop.

### `Intl.Segmenter` is not the architecture

It appears in one function (`firstAnchorGrapheme`), reached only from tier 3. Everything else
counts UTF-16 code units, and chunk boundaries carry no grapheme or code-point integrity
guarantee (the default `text.split('')` splitter emits lone surrogates for astral
characters). Measured, cluster anchoring is inert on every splitter in the matrix: a one-line
code-point regex is output-identical across 432 scenarios, and the segmenter returned a
multi-code-point cluster 0 times in 31,935 tier 3 anchorings. Keep it as a correctness margin
if you like, but **don't reintroduce it into tiers 1-2** — that is where both quadratics came
from. What the whole scheme rests on is `end = start + part.length` (decoded length equals
source span), which is what `tokenizer-length-inflation` addresses.

### Coverage contract

Also in the `split()` docstring and the README's "Chunk Coverage and Positions". From
`chunks[0].start` onward, every UTF-16 code unit appears in exactly one chunk (modulo
`chunkOverlap`); the last chunk's `end` equals the **total source length**. For an array
input that total is the sum of the element lengths, not the array's own `length`. The only
uncovered region is code units before `chunks[0].start`. **Don't break this** — downstream
RAG/citation use cases rely on it.

## Pitfalls

### Use the project's Node version

The default `node` on this machine is **v16**, too old for the toolchain (eslint 10, npm 11)
and it produces baffling errors. Each `Bash` invocation is a fresh shell, and `nvm use` only
finds `.nvmrc` from inside the project, so chain it inline every time:

```sh
source ~/.nvm/nvm.sh && cd /Users/rye/scm/nf/llm-splitter-rewrite && nvm use
```

### `dist/` only contains `.d.ts` — that's intentional

`dist/index.d.ts` has lines like `export { ... } from "./split.js"`. There is no
`dist/split.js`, and that's fine: TypeScript resolves `.js` in a `.d.ts` to a sibling `.d.ts`
(`dist/split.d.ts`), while Node resolves `src/` via `main`. Two independent graphs. Verified
by hand against a packed tarball under `moduleResolution: nodenext` and `bundler`, plus
runtime ESM and `require()`. No automated test — see "Considered and declined".

### JSDoc gotchas under `strict` + `checkJs`

- `// @ts-expect-error <reason>` works in `.js` when `checkJs` is on. Use it for tests that
  intentionally pass bad arguments.
- Empty array literals need an annotation: `/** @type {string[]} */ const x = []`.
- Arrow helpers need `@param`: `/** @param {string} text */ text => text.split('')`.
- **`@overload` does not work on an arrow function**, and multiple `@overload` tags in one
  block don't work either. It is silently ignored, so you get no error, just no narrowing.
  `split` and `getChunk` instead declare a `@typedef` of call signatures and export a cast of
  a private `…Impl` arrow. **One** cast is required — drop it and declaration emit writes the
  impl's union signature, so consumers get no narrowing and nothing errors to tell you. A
  second hop through `unknown` is _not_ required: `/** @type {SplitFn} */ (splitImpl)` emits
  `export declare const split: SplitFn` identically, verified under `strict` + `checkJs` with
  real declaration emit, not `noEmit`.

### Overload sets keep a union signature last

`SplitFn` and `GetChunkFn` each end with a `string|string[]` signature after the two narrow
ones. Not redundant: delete it and a caller holding a `string | string[]` variable matches
neither signature and fails with `TS2769: No overload matches this call`. Don't "simplify" it
away — but note this is the only part of the cast machinery that survives scrutiny; see the
`@overload` bullet above for the part that didn't.

Both claims are now pinned by a probe rather than by this paragraph: run
`npm run build && npx tsc -p .claude/skills/type-probe/tsconfig.json`, or invoke the
`type-probe` skill. It compiles against `dist/`, because `check:types` uses `noEmit` where
these casts have no effect. Each assertion was validated by mutating `src/` and confirming the
probe fails — see the table in its `SKILL.md`. **Run it after touching the export list, the
call-signature typedefs, the casts, `Chunk`, or `SplitOptions`.**

### Don't reintroduce removed tooling

`commitlint`, `husky`, `lint-staged`, `typescript-eslint`, `ts-node`, and `globals` were
deliberately removed, along with the `prepare` script. Ask first if you want any back.
`@changesets/cli` and `@changesets/changelog-github` are the exception — they drive releases
(docs/CONTRIBUTING.md, "Releasing with Changesets").

Three CI files were removed for reasons not recoverable from the diff:

- `notify-release.yml` — superseded by Changesets; `changesets/action/publish` creates the
  release and tag itself.
- `check-linked-issues.yml` — requirement dropped deliberately; also retired a
  `pull_request_target` fork-privileged trigger.
- `dependabot.yml` — zero production dependencies, so the PR noise wasn't worth it.
  `npm run dep:check` covers dev-dependency drift on demand.

### `GITHUB_TOKEN` in the release workflow has two unrelated consumers

`changesets/action@v2` takes a `github-token` **input** and no longer reads the env var. But
`@changesets/changelog-github` runs inside `changeset version` as a library and still reads
`process.env.GITHUB_TOKEN` to resolve each changeset's commit into a PR link. It throws
outright when the var is missing, so the `version` job keeps an explicit `env: GITHUB_TOKEN`.
Deleting it as "v1 leftover" makes the release PR stop opening.

It fails invisibly in local dry runs: an **uncommitted** changeset has no commit to look up,
so the generator skips the API and succeeds on a dirty tree while the same changeset fails in
CI. Commit the changeset first to exercise the real path.

### `prepack` is what puts `dist/` in the tarball

`files` ships `src` and `dist`, but nothing else builds `dist/` at publish time. Without
`prepack` (`npm run build`), `types` points at a file that isn't there. Don't drop it on the
grounds that CI already builds.

### Demo (`index.html`) imports from `src/`, not `dist/`

The [demo-page workflow](.github/workflows/demo-page.yml) copies `src/` into `demo-public/`.
There is no build step for the demo.

### Score anchoring changes with real splitters, not stubs

Two ways this has gone wrong:

- A synthetic drift regression passed for a hybrid-cursor attempt at tokenizer length
  inflation that broke `tiktoken` on a Devanagari fixture. Run any tokenizer-affecting change
  against the multibyte fixtures **and** the real gte-small ones, both parked in
  `openspec/changes/tokenizer-length-inflation/design.md` → "Acceptance criteria".
- A `() => parts` stub scored the decoy-grapheme fix at "906 → 395, a mitigation", nearly
  shelving it. Against a real splitter it was 10.5% → 0%.

`openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md` →
"Reproducing the measurements" is a reusable differential harness.

### The benchmark baseline is downloaded, not installed or vendored

`test/benchmark.js` compares this working copy against published `llm-splitter@0.2.0`, whose
three dependency-free ESM files are fetched from jsDelivr into `test/.cache/` (gitignored),
verified against pinned SHA-256 digests, and reused offline. A clean clone needs `npm ci`
plus network once.

- **Don't loosen the digests in `BASELINE_FILES`** — the script executes downloaded code, so
  a mismatch is a hard failure. Bumping `BASELINE_VERSION` means regenerating them
  (command is in the docstring above the constant).
- **Don't "simplify" it into a devDependency.** An unaliased `npm i -D llm-splitter` works
  today only because this package has no `exports` map (see below). Add one and Node's
  self-reference makes the baseline `src/index.js`, so the benchmark reports zero differences
  against itself.
- **Excluded from `check:types` and `npm run check`** — the baseline import resolves through
  a cache URL, so `tsc` has no static path; the run also takes minutes and needs network.
  `test/.cache/` is in the eslint and prettier ignore lists too.

Behind a corporate proxy the first run fails with `fetch failed`: Node's `fetch` ignores
`HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is in the environment, and setting it from inside
the script does not work because undici reads it at bootstrap.

## Spec-driven workflow (OpenSpec)

[OpenSpec](https://github.com/Fission-AI/OpenSpec) tracks what the library guarantees today
vs what changes next. Full workflow in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

- `openspec/specs/` — the current contract as capabilities (`chunking`, `chunk-coverage`,
  `multibyte-anchoring`, `chunk-extraction`, `splitter-positions`). The README is the human
  narrative; specs are the structured source of truth.
- `openspec/changes/` — proposed work (proposal + design + spec deltas + tasks).
- Drive from Claude Code with `/opsx:propose` → `/opsx:apply` → `/opsx:archive`. Validate
  with `openspec validate --all --strict`.

## Open work

- **Tokenizer length inflation** — normalizing embedding tokenizers (`gte-small` and friends)
  mis-anchor or throw. Everything lives in
  [openspec/changes/tokenizer-length-inflation/](openspec/changes/tokenizer-length-inflation/),
  including both failing test suites (`design.md` → "Acceptance criteria") and the gte-small
  evidence (`research.md`). Nothing for it lives in `test/split.test.js` — the suite is
  unconditional and green.

- **Three residual anchoring defects have a remedy, not a fix.** `splitter-reported-positions`
  shipped the way around them: a splitter may return `{ text, start }`, and a reported offset
  skips all three tiers. The search itself is unchanged and still gets these wrong:

  1. **Tier 2 takes the first verbatim match — 489 of 20,000 (2.4%).** Not a U+FFFD bug:
     `split("a....", { splitter: (t) => t.split("...").filter(Boolean) })` puts the `"."` at
     1; it is at 4. Largest of the three. Candidate verification cannot touch it — a verbatim
     hit aligns at every position by construction.
  2. **Tier 3 candidate a one-character skeleton cannot rule out — 158 of 15,986.** When a
     part carries one non-U+FFFD code unit and that unit _is_ the anchor grapheme,
     verification re-tests what already matched.
  3. **Tier 1 manufactured vs literal U+FFFD — 7 oracle residual.** Provably not fixable from
     the text; see
     [the archived Decision 4](openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md).

  **Measured dead ends, so none is re-proposed:** one-part lookahead fixes 0 of 124,
  rightmost-greedy is worse (578 vs 489), skeleton verification on tier 2 is vacuous, and a
  global alignment search is ambiguous (`"a...."` admits four valid alignments).

## Considered and declined

Surfaced in the pre-`0.3.0` review and declined on the merits — not parked pending a version.
Each says what would change our mind.

- **No `exports` map — we prefer a soft contract.** `main` + `types` already resolve
  correctly with no `exports` field, verified against a packed tarball under
  `moduleResolution: nodenext` and `bundler`, plus runtime ESM and `require()`. So the
  `src`/`dist` skew is not a reason to add one; the only thing `exports` buys is
  encapsulation, and we would rather document the supported surface than have the resolver
  enforce it. Deep paths like `import('llm-splitter/src/split.js')` resolve today; that is
  accepted, not an oversight. `split()` and `getChunk()` from the package root are the
  contract.

  Changes our mind: a report of someone depending on an internal path in a way that blocks a
  refactor. The minimal form, kept so the option stays one edit away:

  ```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./src/index.js" },
    "./package.json": "./package.json"
  }
  ```

  Keep `main`/`types` alongside for legacy resolvers; `./package.json` keeps manifest-reading
  tooling working. Measured: deep imports start returning `ERR_PACKAGE_PATH_NOT_EXPORTED` and
  everything else stays green. It is a breaking change for deep importers, so it wants its own
  minor and a changeset that says so.

- **No bundled reporting splitter.** A `delimiterSplitter(delimiter)` export shipped and was
  removed. It changes no position for any splitter shape a chunking caller reaches for:
  single-character delimiters and character-class regexes cannot reach the tier 2 decoy at all
  (a part never contains a character the splitter splits on), and `tiktoken` / `text.split('')`
  drop nothing between parts. Measured over 4,000 random strings on an alphabet seeded with the
  delimiter characters, bare `split(d).filter(Boolean)` vs. the reporting form: `" "` `"."`
  `"|"` and `/\s+/` `/[.!?]+/` `/[.!?]+\s*/` all 0 differences; only multi-character strings
  differ (`". "` 60, `"--"` 11, `"\n\n"` 8), and `"\n\n"` is `chunkStrategy: "paragraph"`
  already. The 2,424 / 5,140 / 1,566 figures that justified it came from the decoy corpus,
  which was built to hit the defect — a bug measurement, not evidence a caller hits it.

  Changes our mind: a caller who chunks on a multi-character string delimiter that isn't
  `"\n\n"`. The `{ text, start }` contract stays either way, but see below — it is accepted, not
  advertised.

- **`{ text, start }` is accepted but undocumented.** No JS tokenizer in reach exposes offsets:
  `@huggingface/transformers` v4.2.0 returns `{input_ids, attention_mask, token_type_ids}` with
  no `offset_mapping` and no `return_offsets_mapping`, and `tiktoken`'s JS surface is
  `encode`/`decode` only. (Python fast tokenizers do; the JS ports do not. Do not repeat the
  claim that they do — it was in the README for a while and it was wrong.) The caller who _can_
  report — a regex splitter using `matchAll`, which gets `m.index` where `split` discards it —
  gains nothing measurable: byte-identical output, and 6.5ms vs 5.8ms on 270KB, because
  per-part object allocation costs more than the tier 1 `startsWith` it skips. Meanwhile a
  reported `start` does **not** help normalizing tokenizers, since `end` is still
  `start + text.length`.

  So it serves only the tier 2 decoy population, which is the same near-empty set
  `delimiterSplitter` was removed for. Kept because it costs no export, because adding `end`
  later is additive, and because `normalizePart` unifying both paths is what keeps coverage
  identical across a mixture. Not in the README, not in the changeset, not in the examples.

  Changes our mind: implement the consumed span (`tokenizer-length-inflation`), which is the
  half with a real population. Advertise the whole thing then, or not at all.

- **No packaged-consumer test.** Nothing in CI installs a packed tarball and imports by name,
  so the resolution model above is verified only by hand. Disproportionate for a package this
  shape — worth reconsidering if `exports` lands, since that breaks resolution silently.

- **No `engines` field.** The constraint causes more friction than it prevents.
