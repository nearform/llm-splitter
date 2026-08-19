# Development

How development works in this repo now that it uses
[OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development. For
architecture, the algorithm map, and pitfalls, see [AGENTS.md](../AGENTS.md).

## Prerequisites

Use the project's Node version (the default `node` on some machines is too old for the
toolchain):

```sh
source ~/.nvm/nvm.sh && cd <repo> && nvm use   # honors .nvmrc (lts/*)
```

Install the OpenSpec CLI **globally** (it is required to init/validate/archive; Claude
drives the workflow through it):

```sh
npm install -g @fission-ai/openspec@latest   # requires Node >= 20.19
```

It is intentionally **not** a `devDependency` — this library ships zero runtime deps and a
deliberately trimmed dev toolchain (see AGENTS.md "Don't reintroduce removed tooling"). The
CLI lives on your machine, not in `package.json`.

The Claude Code integration (the `/opsx:*` commands under `.claude/commands/opsx/` and the
`openspec-*` skills under `.claude/skills/`) **is** committed, so you get the workflow just by
cloning. Personal `.claude/settings.json` stays gitignored. If the CLI is upgraded, run
`openspec update` to regenerate those files, or `openspec init --tools claude` on a fresh
checkout that somehow lacks them.

## Mental model

Two directories under `openspec/`, plus the README:

- **`openspec/specs/`** — _what the library guarantees today_, as capabilities with
  requirements and `WHEN/THEN` scenarios. The current capabilities are `chunking`,
  `chunk-coverage`, `multibyte-anchoring`, and `chunk-extraction`. This is the structured
  source of truth.
- **`openspec/changes/`** — _what we're going to change next_: one folder per proposal, each
  with `proposal.md` (what & why), `design.md` (how), spec **deltas** under `specs/`
  (`## ADDED` / `## MODIFIED` / `## REMOVED` requirements), and `tasks.md`.
- **`README.md`** — stays the human-facing narrative and API guide. When behavior changes,
  update the spec _and_ the README.

Archiving a completed change merges its deltas back into `openspec/specs/`, so `specs/` stays
the accumulated truth over time.

## The guided-build loop (Claude Code)

Drive the whole loop from Claude Code with the `/opsx:*` slash commands — you shouldn't need
the raw `openspec` CLI for day-to-day work. Just type the command in your Claude Code session;
Claude runs the underlying tooling and writes the artifacts for you.

1. **`/opsx:explore` (optional)** — a thinking partner to clarify a fuzzy idea, investigate a
   problem, or firm up requirements before committing to a proposal.
2. **`/opsx:propose "<what you want to build>"`** — creates `openspec/changes/<name>/` and
   generates every planning artifact (proposal, design, spec deltas, tasks) in one step. This
   is **planning only** — it will not touch `src/`. Review the artifacts, then ask Claude to
   revise anything.
3. **`/opsx:update`** — revise an existing change's artifacts and keep them coherent (fold in
   a new decision, reconcile after an edit). Still planning-only.
4. **`/opsx:apply`** — implement the change against its spec, working through `tasks.md` and
   checking items off. This is where `src/` and `test/` change. Run the repo gates below
   before considering it done.
5. **`/opsx:archive`** — validate that all tasks are complete, merge the change's deltas into
   `openspec/specs/`, and move the change to `openspec/changes/archive/YYYY-MM-DD-<name>/`.
   Use **`/opsx:sync`** instead if you want the delta specs folded into `openspec/specs/`
   without archiving the change yet.

Inspecting state has no slash command — ask Claude (or run the CLI directly) when you want to
list or validate:

```sh
openspec list --changes            # in-flight proposals
openspec list --specs              # capabilities we have today
openspec show <name>               # render a change or spec
openspec validate --all --strict   # validate every spec + change
```

## Repo-specific gates (still apply to specced work)

Spec-driven doesn't replace this repo's existing checks — a change is not done until:

- `npm run check` passes — lint + `check:types` (JSDoc via `tsc`) + `node --test` + prettier.
- `B7_TEST=1 npm test` passes for any **tokenizer-affecting** change — it lazy-loads
  `Xenova/gte-small` (~23 MB) to exercise the real normalizing-tokenizer fixtures. Plain
  `npm test` reports them as skipped. (See AGENTS.md: synthetic passing is not sufficient.)
- `node tmp-benchmark-rewrite.js` shows no regression after any `src/split.js` **algorithm**
  change — verify perf claims with the benchmark, not by reasoning.

See AGENTS.md for the full rationale behind each gate.

## Worked example: the B7 change

[openspec/changes/tokenizer-length-inflation/](../openspec/changes/tokenizer-length-inflation/)
is the reference proposal to imitate. It converts the long-form design doc
[tokenizer-length-inflation.md](tokenizer-length-inflation.md) into structured artifacts:
a `proposal.md`, a `design.md` recording the reverted hybrid-cursor attempt and the chosen
direction, spec **deltas** on `multibyte-anchoring` (modified tokenizer boundary + new
normalized Tier-3 anchor) and `chunking` (new opt-in `sourceNormalize` option), and a
phased `tasks.md` (Phase 1 fixtures done; Phase 2 implementation pending). When it ships,
`openspec archive tokenizer-length-inflation` folds those deltas into `openspec/specs/`.
