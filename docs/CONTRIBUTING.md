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

Intentionally _not_ a `devDependency` — see AGENTS.md, "Don't reintroduce removed tooling".
The `/opsx:*` commands and `openspec-*` skills under `.claude/` **are** committed, so the
workflow works on a fresh clone; run `openspec update` after a CLI upgrade.

## Spec workflow

- `openspec/specs/` — what the library guarantees today (`chunking`, `chunk-coverage`,
  `multibyte-anchoring`, `chunk-extraction`, `splitter-positions`). Structured source of truth.
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

## Releasing with Changesets

This repo uses [Changesets](https://changesets.dev) (v3) for versioning and publishing.
Releases are automated: merging to `main` publishes to npm over OIDC — no manual
`npm publish`.

### Add a changeset to your PR

If your change affects published behavior, run `npx changeset`. It prompts for a bump type
and a summary, then writes a markdown file under `.changeset/`. **Commit that file with your
PR.**

- **Bump type** — while pre-1.0, `minor` is the breaking-change slot (`0.2.0` → `0.3.0`)
  and `patch` covers fixes and compatible features alike; skip `major`, which publishes
  `1.0.0` outright. From 1.0 on it's plain semver: `major` for breaking, `minor` for
  backwards-compatible features, `patch` for fixes.

- **Summary** — write it for the changelog reader: what changed and why it matters, not
  the internal mechanics.

PRs with **no user-facing change** (docs, CI, tests, specs, refactors) don't need a
changeset. Every PR gets a comment from the
[PR status workflow](../.github/workflows/comment-changesets-pr-status.yml) saying whether
one is present — it's a prompt, not a gate. To make "no release needed" explicit, run
`npx changeset --empty`.

Check what's pending at any time:

```sh
npx changeset status
```

### What happens on merge

The [Release workflow](../.github/workflows/release.yml) runs on every push to `main` and
picks one of two paths via `changesets/action/select-mode`:

1. **Changesets pending** → the `version` job opens (or updates) a **"Version Packages"**
   PR. That PR consumes the pending changesets, bumps `version` in `package.json`, and
   updates `CHANGELOG.md`.
2. **No changesets, unpublished version** → the `pack` job builds `dist/*.d.ts` and packs
   a tarball, then the `publish` job publishes it to npm and creates the git tag and
   GitHub release. So **merging the "Version Packages" PR** is what triggers a release.

Authentication uses GitHub OIDC
([trusted publishing](https://docs.npmjs.com/trusted-publishers)), so no npm token is
stored in the repo and provenance is attached automatically. `id-token: write` is granted
only to the `publish` job.
