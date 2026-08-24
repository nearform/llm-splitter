// Type-level probe for the published type surface. Not part of `npm run check`
// — see SKILL.md for when to run it.
//
// Every assertion here pins a claim that was once written down and treated as
// verified because it was written down. It runs against `dist/`, not `src/`,
// because the failure it mainly exists for appears only in declaration emit:
// `check:types` uses `noEmit`, where the overload casts are irrelevant and a
// dropped cast passes silently.

import { split, getChunk } from "../../../dist/index.js";
import type { Chunk, SplitOptions } from "../../../dist/index.js";

declare const eitherInput: string | string[];

// --------------------------------------------------------------------------
// Narrowing reaches consumers.
//
// Catches: the `/** @type {SplitFn} */` cast being dropped from the export.
// Without it, declaration emit writes the impl's union signature and both of
// these stop compiling. Nothing else in the repo notices.
// --------------------------------------------------------------------------
const fromString: Chunk<string>[] = split("hello");
const fromArray: Chunk<string[]>[] = split(["hello"]);

// ...and the narrowed `text` needs no union handling at the call site, which
// is the whole point of the generic.
const oneText: string = fromString[0].text;
const manyText: string[] = fromArray[0].text;

// --------------------------------------------------------------------------
// A `string | string[]` caller still compiles.
//
// Catches: deleting the third (union) signature from `SplitFn`/`GetChunkFn`.
// Without it this is `TS2769: No overload matches this call`.
// --------------------------------------------------------------------------
const fromUnion: Chunk<string | string[]>[] = split(eitherInput);

// A bare `Chunk[]` annotation still accepts the result (default type params).
const bare: Chunk[] = split(eitherInput);

// --------------------------------------------------------------------------
// `getChunk` narrows in parallel with `split`.
// --------------------------------------------------------------------------
const oneChunk: string = getChunk("hello", 0, 2);
const manyChunks: string[] = getChunk(["hello"], 0, 2);
const eitherChunk: string | string[] = getChunk(eitherInput, 0, 2);

// --------------------------------------------------------------------------
// The reported-position form stays honored but unnamed.
//
// `{ text, start }` is binding per openspec/specs/splitter-positions, so both
// the pure and mixed forms must compile...
// --------------------------------------------------------------------------
const reporting: SplitOptions = {
  splitter: () => [{ text: "hello", start: 0 }],
};
const mixed: SplitOptions = {
  splitter: () => ["hello", { text: "world", start: 6 }],
};

// ...while staying unnameable from the package root. Re-export `SplitterPart`
// and this directive goes unused, which tsc reports as an error.
// @ts-expect-error SplitterPart is deliberately not exported — see AGENTS.md
import type { SplitterPart } from "../../../dist/index.js";

// `delimiterSplitter` was removed. Re-adding it should be a deliberate act
// with a changeset, not a quiet reappearance.
// @ts-expect-error delimiterSplitter is not part of the public surface
import { delimiterSplitter } from "../../../dist/index.js";

// --------------------------------------------------------------------------
// The narrowing is real, not `any` leaking through the cast. Widening the
// export's cast to `any` makes this assignment succeed, so the directive below
// goes unused and tsc errors. (An extra hop through `unknown` does *not* do
// this — it still lands on `SplitFn`, which is why it was removable.)
// --------------------------------------------------------------------------
// @ts-expect-error split(string) yields Chunk<string>[], not Chunk<string[]>[]
const wrongWay: Chunk<string[]>[] = split("hello");

// @ts-expect-error a splitter must return parts, not a bare string
const badSplitter: SplitOptions = { splitter: () => "nope" };

export type ProbeUsed = [
  typeof oneText,
  typeof manyText,
  typeof fromUnion,
  typeof bare,
  typeof oneChunk,
  typeof manyChunks,
  typeof eitherChunk,
  typeof reporting,
  typeof mixed,
  typeof wrongWay,
  typeof badSplitter,
  SplitterPart,
  typeof delimiterSplitter,
];
