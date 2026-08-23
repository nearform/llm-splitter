# splitter-positions Specification

## Purpose

Lets a splitter report the source offset of each part it returns, so `split()` uses a known
position instead of inferring one by searching the source. This is the contract for the reported
form, its validation, and its precedence over the anchoring search.

**Accepted, not advertised.** The form is honored wherever a splitter uses it, and everything
below is binding. It is deliberately absent from the README, the changeset, and the exported
type names, because the population it currently serves is close to empty: no JS tokenizer in
reach exposes offsets, a splitter that can report them gains nothing measurable, and a reported
`start` does not help the normalizing tokenizers that have the real anchoring problem — `end`
is still `start + text.length`. Advertising waits on a reported consumed span
(`tokenizer-length-inflation`), which is the half with a population. See AGENTS.md, "Considered
and declined".

## Requirements

### Requirement: A splitter MAY report each part's source position

A splitter MAY return, for any element, an object of the form `{ text: string, start: number }`
in place of a bare string. `start` SHALL be the zero-based UTF-16 code unit offset of `text` in
the input the splitter received. The two forms MAY be mixed in one returned array, so a splitter
that knows some offsets and not others reports only the ones it knows.

#### Scenario: A reported position is used verbatim

- **WHEN** a splitter returns `{ text, start }` for a part
- **THEN** that part's chunk `start` is the reported offset, its `end` is the reported offset
  plus `text.length` bounded by the input length, and no search of the source is performed for it

#### Scenario: A part reported at a position the search would not have found

- **WHEN** a splitter reports a part at an offset later than the first verbatim occurrence of
  that text at or after the cursor
- **THEN** the reported offset is used, and the code units the search would have claimed are
  covered by the preceding chunk under the coverage contract

#### Scenario: Bare strings keep the existing behavior

- **WHEN** a splitter returns only bare strings
- **THEN** parts are positioned by the existing three-tier locate strategy and results are
  unchanged from a splitter that never reported positions

#### Scenario: Mixed forms in one array

- **WHEN** a splitter returns a mixture of bare strings and `{ text, start }` objects
- **THEN** reported parts use their reported offset, bare parts are located by search, and the
  cursor advances consistently across both so coverage holds

### Requirement: A reported position SHALL be validated

An invalid reported position SHALL throw a `TypeError` naming the offending part, rather than
being silently corrected or used. `start` SHALL be a non-negative integer no greater than the
input length, `text` SHALL be a string, and reported positions SHALL NOT move the cursor
backwards.

#### Scenario: Non-integer or out-of-range offset

- **WHEN** a splitter reports a `start` that is negative, fractional, `NaN`, or greater than the
  input length
- **THEN** `split()` throws a `TypeError` identifying the part and the rejected offset

#### Scenario: Missing or non-string text

- **WHEN** a reported element is an object whose `text` is absent or not a string
- **THEN** `split()` throws a `TypeError` identifying the part

#### Scenario: Positions that move the cursor backwards

- **WHEN** a splitter reports a part whose `start` precedes the end of the previously placed part
- **THEN** `split()` throws a `TypeError`, because accepting it would break the coverage
  contract by making chunks overlap unrequested

#### Scenario: Reported text that does not match the source at the reported offset

- **WHEN** a splitter reports a part whose `text` is not equal to the input at the reported
  offset
- **THEN** the reported offset is still used, because a byte-mutating splitter legitimately
  returns text that differs from its source span, and rejecting it would exclude tokenizers

### Requirement: Reporting is a contract, not a bundled splitter

The reported-position form is the capability; building a splitter on it is the caller's. The
library SHALL NOT export a delimiter-based or otherwise pre-built reporting splitter, nor a
type naming the reported form, so the supported surface stays `split()`, `getChunk()`, and the
`Chunk` / `SplitOptions` types. The form SHALL stay usable through `SplitOptions["splitter"]`
without being nameable from the package root.

#### Scenario: Package exports

- **WHEN** the package root is imported
- **THEN** `split` and `getChunk` are available, along with the `Chunk` and `SplitOptions`
  types, and neither a pre-built reporting splitter nor a `SplitterPart` type is

#### Scenario: A TypeScript caller writes a reporting splitter

- **WHEN** a caller assigns a splitter returning bare strings, `{ text, start }` objects, or a
  mixture, to `SplitOptions["splitter"]`
- **THEN** all three forms type-check, without the caller importing a name for the part type

Both scenarios above are checked by the `type-probe` skill
(`.claude/skills/type-probe/`), which compiles against the emitted declarations. Changing
either one means deleting an assertion there.
