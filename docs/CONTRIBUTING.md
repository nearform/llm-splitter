# Development

Architecture, the algorithm map, and pitfalls live in [AGENTS.md](../AGENTS.md). This file
covers only the setup that isn't obvious from the repo itself.

## Prerequisites

Use the project's Node version — the default `node` on some machines is too old for the
toolchain and produces baffling errors:

```sh
source ~/.nvm/nvm.sh && cd <repo> && nvm use   # honors .nvmrc (lts/*)
```

Install the OpenSpec CLI **globally**:

```sh
npm install -g @fission-ai/openspec@latest   # requires Node >= 20.19
```

It is intentionally _not_ a `devDependency` — this library ships zero runtime deps and a
deliberately trimmed dev toolchain (see AGENTS.md, "Don't reintroduce removed tooling").
The `/opsx:*` commands and `openspec-*` skills under `.claude/` **are** committed, so the
workflow works on a fresh clone; run `openspec update` after a CLI upgrade.

## Spec workflow

- `openspec/specs/` — what the library guarantees today (`chunking`, `chunk-coverage`,
  `multibyte-anchoring`, `chunk-extraction`). Structured source of truth.
- `openspec/changes/` — one folder per proposal: `proposal.md`, `design.md`, spec deltas
  under `specs/`, `tasks.md`. Archiving merges the deltas into `openspec/specs/`.
- `README.md` — the human-facing narrative. When behavior changes, update the spec _and_
  the README.

Drive it from Claude Code: `/opsx:propose` → `/opsx:apply` → `/opsx:archive`
(`/opsx:explore` to think first, `/opsx:update` to revise). Run `openspec --help` for
direct CLI use.

## Gates

A change is not done until `npm run check` passes. Tokenizer-affecting work additionally
has to clear the gte-small fixtures parked in the tokenizer change's `design.md`. See
AGENTS.md for the rationale behind each.
