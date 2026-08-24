---
name: type-probe
description: Compile the type-level probe against the emitted declarations to check that the published type surface still narrows, still accepts a union input, and still hides what should stay private. Use after touching src/index.js exports, the SplitFn/GetChunkFn typedefs, the casts on the split/getChunk exports, the Chunk generic, or SplitOptions.
allowed-tools: Bash(npm run build), Bash(npx tsc:*), Read, Edit
---

# Type probe

`npm run check` cannot catch regressions in the published type surface. `check:types` runs
`noEmit`, where the overload casts on `split` and `getChunk` have no effect — drop one and
consumers silently lose narrowing while every gate stays green. This probe compiles against
`dist/`, so it sees what a consumer sees.

## Run

```sh
npm run build && npx tsc -p .claude/skills/type-probe/tsconfig.json
```

Exit 0 means the surface is intact. `npm run build` first is required: the probe imports
`../../../dist/index.js`, and `dist/` is gitignored, so a fresh clone has nothing to check.

## When to run

Any change to:

- `src/index.js` — the export list, or the `@typedef` re-exports
- `SplitFn` / `GetChunkFn` — the call-signature typedefs in `src/split.js`, `src/get-chunk.js`
- the `/** @type {SplitFn} */ (splitImpl)` casts on the exports
- the `Chunk` generic or `SplitOptions`

## What each assertion pins

Every line exists because a claim about it was once written down and then treated as verified
because it was written down. Each was checked by mutating the source and confirming the probe
fails:

| Regression                                | Probe reports                        |
| ----------------------------------------- | ------------------------------------ |
| Cast dropped from the `split` export       | `TS2322` on the `Chunk<string>[]` assignment |
| Union signature deleted from `SplitFn`     | `TS2769: No overload matches this call` |
| `SplitterPart` re-exported from the root   | `TS2578: Unused '@ts-expect-error'`  |
| `delimiterSplitter` re-added to the root   | `TS2578: Unused '@ts-expect-error'`  |
| Export cast widened to `any`               | `TS2578: Unused '@ts-expect-error'`  |

The negative assertions use `@ts-expect-error`, so they are self-checking: if the error they
expect stops happening, the directive is unused and `tsc` fails. That is what makes
re-exposing `SplitterPart` or `delimiterSplitter` a deliberate act — you have to delete an
assertion to do it, which shows up in review.

## Why this lives here and not in `test/`

It is a design guard, not a gate: it needs a build first, it takes a `tsc` run, and it asserts
things about the *published artifact* rather than behavior. Wiring it into `npm run check`
would mean building `dist/` on every check run. The tradeoff is that it only catches what it
claims to catch when someone runs it — so if you are touching anything in the list above, run
it, and say in the PR that you did.

If a `@ts-expect-error` here starts failing and the exposure was intentional, delete that
assertion **and** update `openspec/specs/splitter-positions/spec.md` ("Package exports") plus
AGENTS.md, "Considered and declined" — those record the same decisions in prose.
