## Context

See [proposal.md](./proposal.md) → "Why" for motivation. This records the mechanism, the
prototype, and every measurement taken, because the case for shipping this rests entirely on
the numbers and the case against it rests on one of them.

**The mechanism.** With Tier 2 skipped for U+FFFD-bearing parts, a mixed part is positioned by
the Tier 3 anchor-grapheme search:

```js
const match = input.indexOf(anchor.segment, cursor + anchor.offset);
start = match === -1 ? -1 : match - anchor.offset;
```

`indexOf` returns the **first** occurrence at or after `cursor + offset`. The part's true
position is one of the occurrences, but not necessarily the first: the cursor sits at the end
of the previous part, and a splitter that drops a multi-character span leaves a gap between
there and the part's true start. Any occurrence of the anchor grapheme inside that gap wins.

```
src   = "Intro.\n\n\nCaf� notes.\n\nEnd."
parts = ["Intro.", "\nCaf� notes.", "End."]     // text.split("\n\n")
                    ^ anchor is "\n" at part offset 0

           I n t r o .  \n \n \n  C  a  f  �   ...
index      0 1 2 3 4 5   6  7  8  9 10 11 12
cursor ────────────────► 6
true start ───────────────────────► 8
indexOf("\n", 6) = 6  →  start = 6, two code units early
```

**Why the exception was thought unreachable.** `literal-replacement-char-anchoring` argued from
`text.split(/\s+/)`: it drops only a whitespace run, and its parts contain no whitespace, so no
decoy is reachable. True for that splitter, and it does not generalize — the same specification
lists sentence and line splitters as supported, and those drop `"..."`, `". "`, `"\n\n"`. The
ground-truth differential that cleared the exception was also restricted to a single-character
splitter, so it could not have found this.

**Why Decision 4 in that change does not forbid a fix.** It concluded that no local rule can
separate the spurious case from the legitimate one, on this table:

```
                    part      cursor  tier2  tier3(corrected)  truth
residual (spurious) " �"      2       12     2                 2
decoy (legitimate)  "a�b"     1       4      2                 4
```

That is sound for a rule choosing **between Tier 2's answer and Tier 3's** — identical
signatures, opposite truths. It says nothing about verifying a Tier 3 candidate on its own
terms. A Tier 2 hit is verbatim, so checking the part against the source there is vacuous; a
Tier 3 candidate has matched one grapheme out of the part, so the same check has real
information to add. That distinction is the whole basis of this change.

## Goals / Non-Goals

**Goals:**

- A mixed part that occurs verbatim in the source anchors at its true position when the
  distinguishing evidence is present in the part.
- No regression on any gate `literal-replacement-char-anchoring` established: zero throws,
  zero `OK→THROW`, unchanged positions where the current implementation is right, unchanged
  oracle residual, linear anchoring cost.
- Quantify the residual honestly, including the part this approach does not fix.

**Non-Goals:**

- The Tier 1 residual. Tier 1 fires before Tier 3, so candidate verification cannot see it.
- Closing the remainder (395 of 15,986). That needs backtracking; see Open Questions.
- Any change to normalizing tokenizers, or any new public option.
- Restoring Tier 2 for U+FFFD-bearing parts. That reintroduces the throws and the quadratic
  the previous change removed; measured there at 768 residual throws and 42x cost for an 8x
  input.

## Decisions

### Decision 1: Verify the candidate's skeleton, and continue the search on failure

**Chosen.** Reject a Tier 3 candidate unless every code unit the splitter could not have
invented aligns with the source at that offset; on rejection, advance to the next occurrence
of the anchor grapheme.

```js
const skeletonAligns = (input, splitPart, at) => {
  if (at < 0) {
    return false;
  }
  for (let i = 0; i < splitPart.length; i += 1) {
    const ch = splitPart[i];
    if (ch === REPLACEMENT_CHAR || UNANCHORABLE_CLUSTER.test(ch)) {
      continue;
    }
    if (at + i >= input.length || input[at + i] !== ch) {
      return false;
    }
  }
  return true;
};

// in the tier 3 branch:
let match = input.indexOf(anchor.segment, cursor + anchor.offset);
while (
  match !== -1 &&
  !skeletonAligns(input, splitPart, match - anchor.offset)
) {
  match = input.indexOf(anchor.segment, match + 1);
}
start = match === -1 ? -1 : match - anchor.offset;
```

Comparing at fixed offsets is valid only under the library's existing assumption that a part's
decoded length equals its consumed source span. That is the same assumption `end = start +
part.length` already rests on, so this adds no new one — but it does mean the check is
meaningless for a length-inflating tokenizer, which is `tokenizer-length-inflation`'s scope.

`UNANCHORABLE_CLUSTER` is reused rather than testing U+FFFD alone, so combining marks and
variation selectors — which a splitter can also emit detached — impose no constraint either.

**Measured.** Prototyped in a scratch tree against `src/` at the merge base and at the current
head. Reduced cases first:

| case                                        | base    | head (current) | prototype   |
| ------------------------------------------- | ------- | -------------- | ----------- |
| paragraph splitter, literal U+FFFD          | correct | **wrong**      | **correct** |
| decoy (`"a a a�b"`, splitter drops a token) | correct | **wrong**      | **correct** |
| decoy-x2 (`"a a a a�b"`)                    | correct | **wrong**      | **correct** |
| pinned "genuinely in the source" (`"a �b"`) | correct | correct        | correct     |
| k=2 left edge (`["��cd"]`)                  | wrong   | correct        | correct     |
| mixed tier 3 (`["���", "́�", "�cd"]`)        | wrong   | correct        | correct     |

Then every gate from `literal-replacement-char-anchoring` → "Reproducing the measurements",
run base-vs-prototype and compared against base-vs-head:

| gate                                      | head        | prototype   |
| ----------------------------------------- | ----------- | ----------- |
| fuzz 3,000 / 10,000 strings, 2,000 arrays | 0 throws    | 0 throws    |
| `OK→THROW`                                | 0           | 0           |
| invariant violations                      | 0           | 0           |
| positions moved vs base                   | 142/461/107 | 142/461/107 |
| oracle `ok→off`                           | 0           | 0           |
| oracle residual (all Tier 1 signature)    | 7           | 7           |
| unit suite                                | 172/172     | 172/172     |
| scaling, U+FFFD source, 8x span           | 7.7x        | **7.2x**    |

Identical on everything already covered, and linear — the `while` loop does not reintroduce a
per-part cost in practice, because the skeleton check fails on its first mismatched code unit
and the anchor grapheme is rare enough that candidates are few.

**The class it targets**, ground-truth differential over 15,986 randomized cases using
multi-character-dropping splitters (`"\n\n"`, `". "`, `"..."`, `" | "`, `"\n\n\n"`,
`"  \n\n  "`) whose source holds a literal U+FFFD, parts built at known offsets so truth needs
no inference:

| variant      | parts anchored away from truth |
| ------------ | ------------------------------ |
| merge base   | 258                            |
| current head | **906**                        |
| prototype    | **395**                        |

### Decision 2: File it rather than ship it

**Chosen.** The prototype is a clear improvement and still leaves 395 against the base's 258,
so it is a mitigation, not a fix. Weigh that against what the defect actually costs, all
measured over the same class, though not all on one corpus — each count names its own:

- **Nothing is dropped.** Coverage held in every case (0 violations), and
  `chunk.text === getChunk(input, start, end)` holds unconditionally. The boundary moves
  earlier; code units join the following chunk instead of the preceding one.
- **Displacement is small.** 2-3 code units in 838 of 906 displaced cases, 6 at worst:

  | displacement | 2   | 3   | 4   | 5   | 6   |
  | ------------ | --- | --- | --- | --- | --- |
  | cases        | 294 | 544 | 19  | 13  | 36  |

  It is bounded by the dropped separator plus any displacement already accumulated upstream —
  a part anchored early leaves the cursor early, which lets the next part be found earlier
  still. That compounding is why displacement is not simply the separator length; on this
  corpus it never pushed past it, the worst case (6) matching the longest separator
  (`"  \n\n  "`). Treat 6 as the measured maximum for this splitter set, not a proven bound.

- **In 92% only the separator moves.** 831 of 906 displaced cases move nothing but the
  characters the splitter discarded. The remaining 145 reach into the preceding part and clip
  a token across the boundary.
- **`chunkOverlap` all but removes the observable effect.** Metric: is each part's true source span
  wholly contained in at least one chunk? A clipped token is retrievable from neither chunk
  alone, which is the only consumer-visible symptom. 7,993 cases per row:

  | chunkSize | chunkOverlap | base | head    | prototype |
  | --------- | ------------ | ---- | ------- | --------- |
  | 4         | 0            | 0    | **705** | 26        |
  | 4         | 1            | 0    | 177     | —         |
  | 4         | 2            | 0    | **2**   | **0**     |
  | 8         | 0            | 0    | **275** | 5         |
  | 8         | 1            | 0    | 75      | —         |
  | 8         | 2            | 0    | **2**   | **0**     |
  | 8         | 4            | 0    | **0**   | **0**     |

  The shift is a handful of code units while the overlap is whole tokens, so anything crossing
  the boundary is already duplicated forward.

So: a chunking-quality defect, bounded, coverage-safe, with a one-option caller workaround —
against a 25-line change to the anchoring strategy that does not fully close it and would
change positions for affected inputs. Documenting the workaround (done, in the README) buys
most of the value at none of the risk. What would change the priority: a report from someone
using a multi-character string delimiter on U+FFFD-bearing text at `chunkOverlap: 0` and
depending on exact boundaries, or a decision to close the remainder properly, at which point
this becomes the first half of that work.

Note `chunkOverlap` defaults to `0`, so the default configuration is the exposed one. That is
the strongest argument for shipping anyway.

## Acceptance criteria

Following the convention the sibling changes set, test code lives here until the fix lands, so
`test/split.test.js` stays unconditional and green.

**1. Paragraph-splitter regression.** Fails at current head, passes under Decision 1:

```js
it("anchors a verbatim mixed part after a dropped multi-char separator", () => {
  // The part's anchor grapheme "\n" also occurs inside the "\n\n" the splitter
  // dropped, so the unverified search takes the occurrence at 6 and reports the
  // part two code units before its true start of 8.
  /** @param {string} text */
  const paragraphSplitter = (text) => text.split("\n\n").filter(Boolean);

  const chunks = split("Intro.\n\n\nCaf� notes.\n\nEnd.", {
    chunkSize: 1,
    splitter: paragraphSplitter,
  });

  assert.deepStrictEqual(
    chunks.map(({ start, end }) => [start, end]),
    [
      [0, 8],
      [8, 22],
      [22, 26],
    ],
  );
});
```

**2. Decoy regression**, with no dependence on a delimiter shape:

```js
it("rejects an anchor-grapheme match that the rest of the part contradicts", () => {
  // "a�b" is verbatim at 4. Its anchor "a" also sits at 2, inside the span the
  // splitter dropped, and only the "b" two units on rules that candidate out.
  const chunks = split("a a a�b", {
    chunkSize: 1,
    splitter: () => ["a", "a�b"],
  });

  assert.deepStrictEqual(
    chunks.map(({ start, end }) => [start, end]),
    [
      [0, 4],
      [4, 7],
    ],
  );
});
```

**3. No linearity regression.** Both existing "anchoring cost" scaling regressions must stay
green; the prototype measured 7.2x against head's 7.7x for an 8x span. The `while` loop is the
risk, so if a future change makes candidates common, this is what catches it.

**4. Gate parity.** Run the harness in
`openspec/changes/archive/2026-08-21-literal-replacement-char-anchoring/design.md` →
"Reproducing the measurements" against an unpatched and a patched tree. Bar: every gate it
prints must match what the current head produces — zero throws, zero `OK→THROW`, zero
invariant violations, `ok→off` zero, and the same positions-moved counts.

**5. Class improvement.** The multi-character-dropping differential above must come in at or
below 395 of 15,986, against 906 at head. A materially different number means the corpus or
the patch drifted.

## Reproducing the measurements

Every figure in Decision 1 and Decision 2 comes from the script below. Save it as
`decoy-verify.mjs` anywhere and point it at two directories each holding a copy of `src/`:

```sh
V=$(mktemp -d)
mkdir -p "$V/base/src" "$V/patched/src"
for f in $(git ls-tree --name-only <pre-fix-ref> src/); do
  git show "<pre-fix-ref>:$f" > "$V/base/src/$(basename "$f")"
done
cp src/*.js "$V/patched/src/"
node decoy-verify.mjs "$V/base" "$V/patched"
```

It needs no dependencies - every corpus is synthetic with known offsets, so unlike the
sibling change's harness it does not use `tiktoken` and can live outside the repo.

**Why this exists.** The first version of this design quoted figures whose generator was
never saved, and they did not reproduce: 16,842 / 1,663 / 489 / 678 against this harness's
15,986 / 906 / 258 / 395. Direction and ratio survived (head is ~3.5x base either way) but the
absolute numbers did not, so the recorded ones are now the harness's. A gate that names a
number needs the script that produced it, or it is a number nobody can check.

**One trap worth knowing**, because an early version of this harness fell into it: the corpus
must let a part **begin** with a character the dropped separator contains. Generate parts from
an alphabet that excludes the separator's characters and every splitter shape reports zero,
because the decoy is then unreachable by construction - which reads as "no problem here"
rather than "this corpus cannot see the problem".

Expected output against the current head, reproduced on a clean run:

```
reachability by splitter shape (patched tree):
  regex /[.!?]+/   round-tripped=  3213  wrong=     0
  regex /\s+/      round-tripped=  3213  wrong=     0
  string "..."     round-tripped= 17705  wrong=  5588
  string ". "      round-tripped= 36285  wrong= 10412
  string "\n\n"    round-tripped= 14095  wrong=  3800

class differential over 15986 cases: base wrong=258  patched wrong=906
  coverage broken: 0   displaced: 906   separator-only: 831 (92 percent)
  displacement histogram: {"2":294,"3":544,"4":19,"5":13,"6":36}
```

Under the Decision 1 prototype the same run gives `patched wrong=395`, separator-only 97
percent, and the string-delimiter rows drop to 2,424 / 5,140 / 1,566. `coverage broken` must
stay 0 in every configuration.

```js
// Reproduces every number in this change's Decision 1 and Decision 2.
// Usage: node decoy-verify.mjs <baselineTree> <patchedTree>
// Each tree is a directory holding a copy of src/. Needs no dependencies, so
// it can live anywhere; unlike the sibling change's harness it does not use
// tiktoken, because every corpus here is synthetic with known offsets.
const load = async (d) => (await import(`${d}/src/split.js`)).split;
const [BASE_DIR, PATCHED_DIR] = process.argv.slice(2);
if (!BASE_DIR || !PATCHED_DIR) throw new Error("usage: <baseline> <patched>");
const BASE = await load(BASE_DIR);
const PATCHED = await load(PATCHED_DIR);

const R = "�";
// Deterministic: mulberry32, never Math.random, so both trees see one corpus.
const rngFor = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Builds a case with KNOWN offsets: parts are generated, then joined by a
 * separator the splitter drops, so ground truth needs no inference. `atoms`
 * deliberately includes a separator character where the splitter permits it —
 * that is what makes a decoy reachable, and omitting it silently measures
 * nothing (an early version of this harness did exactly that and reported 0
 * everywhere).
 */
const build = (seed, i, { atoms, sep, minParts = 2, spread = 4 }) => {
  const rng = rngFor(seed + i * 7919);
  const nParts = minParts + Math.floor(rng() * spread);
  const parts = [];
  const truth = [];
  let src = "";
  for (let k = 0; k < nParts; k++) {
    let p = "";
    for (let c = 0, n = 1 + Math.floor(rng() * 5); c < n; c++) {
      p += atoms[Math.floor(rng() * atoms.length)];
    }
    if (k > 0) src += sep(rng);
    truth.push(src.length);
    parts.push(p);
    src += p;
  }
  return { src, parts, truth };
};

const STRING_SEP = { atoms: ["a", "漢", R, "\n"], sep: () => "\n\n" };

// ---- 1. Which splitter shapes reach the class at all -------------------
const SHAPES = [
  {
    name: "regex /[.!?]+/",
    atoms: ["a", "漢", R, "."],
    sep: (r) => ".".repeat(1 + Math.floor(r() * 3)),
    fn: (t) => t.split(/[.!?]+/).filter(Boolean),
  },
  {
    name: "regex /\\s+/",
    atoms: ["a", "漢", R, " "],
    sep: (r) => " ".repeat(1 + Math.floor(r() * 3)),
    fn: (t) => t.split(/\s+/).filter(Boolean),
  },
  {
    name: 'string "..."',
    atoms: ["a", "漢", R, "."],
    sep: () => "...",
    fn: (t) => t.split("...").filter(Boolean),
  },
  {
    name: 'string ". "',
    atoms: ["a", "漢", R, "."],
    sep: () => ". ",
    fn: (t) => t.split(". ").filter(Boolean),
  },
  {
    name: 'string "\\n\\n"',
    atoms: ["a", "漢", R, "\n"],
    sep: () => "\n\n",
    fn: (t) => t.split("\n\n").filter(Boolean),
  },
];
console.log("reachability by splitter shape (patched tree):");
for (const s of SHAPES) {
  let cases = 0;
  let wrong = 0;
  for (let i = 0; i < 40000; i++) {
    const { src, parts, truth } = build(4242, i, s);
    if (!src.includes(R)) continue;
    const got = s.fn(src);
    // Only count cases the splitter round-trips: otherwise "truth" is fiction.
    if (got.length !== parts.length || got.some((g, j) => g !== parts[j]))
      continue;
    cases++;
    let chunks;
    try {
      chunks = PATCHED(src, { chunkSize: 1, splitter: s.fn });
    } catch {
      continue;
    }
    if (chunks.length !== parts.length) continue;
    if (chunks.some((c, k) => c.start !== truth[k])) wrong++;
  }
  console.log(
    `  ${s.name.padEnd(16)} round-tripped=${String(cases).padStart(6)}  wrong=${String(wrong).padStart(6)}`,
  );
}

// ---- 2. Class differential, base vs patched ---------------------------
const SEPS = ["\n\n", ". ", "...", " | ", "\n\n\n", "  \n\n  "];
const classCorpus = (i) => {
  const rng = rngFor(31337 + i * 7919);
  const sep = SEPS[Math.floor(rng() * SEPS.length)];
  return build(31337, i, {
    atoms: ["a", "b", "漢", "é", R, "."],
    sep: () => sep,
  });
};
let cases = 0;
const wrong = { base: 0, patched: 0 };
let covBroken = 0;
let displaced = 0;
let sepOnly = 0;
const hist = {};
for (let i = 0; i < 20000; i++) {
  const { src, parts, truth } = classCorpus(i);
  if (!src.includes(R)) continue;
  cases++;
  const isContent = new Array(src.length).fill(false);
  truth.forEach((t, k) => {
    for (let j = 0; j < parts[k].length; j++) isContent[t + j] = true;
  });
  for (const [name, f] of [
    ["base", BASE],
    ["patched", PATCHED],
  ]) {
    let chunks;
    try {
      chunks = f(src, { chunkSize: 1, splitter: () => parts });
    } catch {
      continue;
    }
    if (chunks.length !== parts.length) continue;
    const bad = chunks.filter((c, k) => c.start !== truth[k]).length;
    if (bad) wrong[name]++;
    if (name !== "patched") continue;
    if (chunks.length && chunks.at(-1).end !== src.length) covBroken++;
    let worst = 0;
    let movedContent = false;
    chunks.forEach((c, k) => {
      const d = truth[k] - c.start;
      if (d <= 0) return;
      worst = Math.max(worst, d);
      for (let j = c.start; j < truth[k]; j++)
        if (isContent[j]) movedContent = true;
    });
    if (worst > 0) {
      displaced++;
      hist[worst] = (hist[worst] ?? 0) + 1;
      if (!movedContent) sepOnly++;
    }
  }
}
console.log(
  `\nclass differential over ${cases} cases: base wrong=${wrong.base}  patched wrong=${wrong.patched}`,
);
console.log(
  `  coverage broken: ${covBroken}   displaced: ${displaced}   separator-only: ${sepOnly} (${((sepOnly / displaced) * 100).toFixed(0)}%)`,
);
console.log(`  displacement histogram:`, JSON.stringify(hist));

// ---- 3. Does chunkOverlap mask it? -----------------------------------
console.log("\nchunkOverlap: parts whose true span is in NO single chunk");
for (const chunkSize of [4, 8]) {
  for (const chunkOverlap of [0, 1, 2, 4]) {
    if (chunkOverlap >= chunkSize) continue;
    let n = 0;
    const tally = { base: 0, patched: 0 };
    for (let i = 0; i < 8000; i++) {
      const { src, parts, truth } = build(31337, i, {
        ...STRING_SEP,
        minParts: 6,
        spread: 14,
      });
      if (!src.includes(R)) continue;
      n++;
      for (const [name, f] of [
        ["base", BASE],
        ["patched", PATCHED],
      ]) {
        let chunks;
        try {
          chunks = f(src, { chunkSize, chunkOverlap, splitter: () => parts });
        } catch {
          continue;
        }
        for (let k = 0; k < parts.length; k++) {
          const span = src.slice(truth[k], truth[k] + parts[k].length);
          if (span && !chunks.some((c) => c.text.includes(span))) tally[name]++;
        }
      }
    }
    console.log(
      `  chunkSize=${chunkSize} overlap=${chunkOverlap}  cases=${n}  base=${tally.base}  patched=${tally.patched}`,
    );
  }
}
```

## Risks / Trade-offs

- **[395 residual]** → Not closed. Those are cases where an earlier offset aligns on every
  non-invented code unit, which gets easier the more of the part is U+FFFD, since those
  positions impose no constraint. A part that is entirely U+FFFD has an empty skeleton and is
  dropped as unanchorable before this code runs, so the bad case is a part that is _mostly_
  U+FFFD with one or two real units.
- **[Positions change for affected inputs]** → Needs a changeset and the "regenerate persisted
  embeddings / citation offsets" note. The prototype moved no position the current
  implementation gets right, so the change is one-directional, but it is still not a patch.
- **[The `while` loop is a per-part search]** → The shape that made `character` splits
  quadratic once before. It is bounded in practice because the anchor grapheme is rare and the
  skeleton check fails fast, and measured linear — but it is the thing to re-measure on any
  change here, not to trust.
- **[Reused `UNANCHORABLE_CLUSTER` is applied per code unit, not per cluster]** → The regex is
  a character class, so testing `splitPart[i]` works for the marks and replacement chars it
  covers. It would not generalize if the predicate ever became cluster-aware; keep it a
  character class or change both call sites together.
- **[Overlap with `tokenizer-length-inflation`]** → That change replaces Tier 3 when
  `sourceNormalize` is set; this one edits the identity path. Whichever lands second rebases,
  and the skeleton comparison is invalid under normalization, so it must stay on the identity
  path only.

## Open Questions

- Does closing the remaining 395 require full backtracking (accept a candidate only if the
  remaining parts still anchor from it), or is there a cheaper rule — preferring the candidate
  whose _following_ part also verifies, a one-part lookahead rather than a full search? The
  lookahead is bounded and worth measuring first; it is recorded here rather than in AGENTS.md
  because it only matters if this change ships.
- Should verification also apply to Tier 2 for non-U+FFFD parts? It is vacuous there today
  (a verbatim match implies alignment), so the answer is no unless Tier 2 ever becomes
  approximate.
