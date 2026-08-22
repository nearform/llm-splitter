# splitter-positions Specification

## Purpose

Lets a splitter report the source offset of each part it returns, so `split()` uses a known
position instead of inferring one by searching the source. This is the contract for the reported
form, its validation, and its precedence over the anchoring search.

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

### Requirement: The library SHALL provide a delimiter splitter that reports positions

A `delimiterSplitter(delimiter)` helper SHALL be exported, returning a splitter that splits on
`delimiter` and reports each part's exact offset. Empty parts SHALL be omitted.

#### Scenario: Delimiter splitter over a source whose part repeats inside the delimiter run

- **WHEN** `delimiterSplitter("...")` is used on `"a...."`
- **THEN** the parts are `"a"` at 0 and `"."` at 4, the offsets the search reports as 0 and 1

#### Scenario: Consecutive delimiters

- **WHEN** the input contains consecutive delimiters, producing empty parts
- **THEN** empty parts are omitted and the remaining parts report their true offsets

#### Scenario: Delimiter absent from the input

- **WHEN** the input contains no occurrence of the delimiter
- **THEN** the splitter reports one part covering the whole input at offset 0
