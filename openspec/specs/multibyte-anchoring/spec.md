## Purpose

The multibyte-anchoring capability maps each splitter part back to a `start`/`end` position
in the original source, correctly handling multibyte Unicode (emoji, CJK, accented Latin,
combining marks) and tokenizers that emit U+FFFD replacement characters when a token
straddles a multi-byte sequence. It defines the three-tier locate strategy and the boundary
of which tokenizers are supported.

## Requirements

### Requirement: Three-tier locate strategy

The system SHALL anchor each part against the source using three tiers, cheapest first:
(1) `startsWith(part, cursor)` for a byte-preserving splitter whose cursor sits exactly on
the part; (2) `indexOf(part, cursor)` for a byte-preserving splitter that drops bytes
between parts; (3) an anchor-grapheme search for a byte-mutating splitter that emits U+FFFD,
walking the part's graphemes to the first anchorable one (not U+FFFD, not a combining mark or
variation selector).

**Tier 3 SHALL position the part's left edge, not its anchor grapheme.** The first anchorable
grapheme sits at some offset `k ≥ 0` into the part, so the system SHALL search from
`cursor + k` and set `start` to the match position minus `k`. Searching from `cursor + k` is
what keeps the corrected `start` at or after the cursor. Anchoring at the match position
itself would place a part of width `part.length` with its left edge at an interior grapheme,
contradicting the length-based advance below.

**Tier 3 SHALL verify a candidate before accepting it.** The anchor grapheme is one cluster
out of the whole part, so a match on it is evidence about that cluster only. Before accepting
a candidate offset, the system SHALL check that every code unit of the part that the splitter
could not have invented — everything other than U+FFFD, combining marks and variation
selectors — appears at the corresponding offset in the source. Where it does not, the system
SHALL continue the search from the next occurrence of the anchor grapheme rather than accept
the candidate. This is not the same test as a Tier 2 verbatim match, which already implies
agreement at every position and therefore verifies nothing; a Tier 3 candidate does not.

**The system SHALL skip Tier 2 for every part containing U+FFFD**, whether or not the source
contains one. For a source with no U+FFFD this is an equivalence — the skipped search could
only have reported "not found". For a source that does contain one it is a deliberate
preference for Tier 3 over a verbatim match: U+FFFD is a character the splitter invented, so
a verbatim hit on it carries no information about where the part came from, and acting on
such a hit displaces parts and throws. U+FFFD is the only character a supported splitter can
introduce that was not in the source (see "Supported tokenizer boundary"), so no other part
content admits either inference.

Regardless of which tier located the part, the system SHALL set `end = start + part.length`
clamped to input length, and SHALL advance the cursor to that `end`. This length-based
advance is what assumes decoded length equals consumed source span (see "Supported tokenizer
boundary").

#### Scenario: Tier 1 — cursor on the part

- **WHEN** a byte-preserving splitter (e.g. the character or tiktoken happy path) leaves the cursor exactly on the next part
- **THEN** the part is anchored via `startsWith` at the cursor

#### Scenario: Tier 2 — dropped bytes between parts

- **WHEN** a splitter drops bytes between parts (e.g. `text.split(/\s+/)` discarding whitespace) so the cursor lands in the gap
- **THEN** the whole part is located verbatim via `indexOf` forward from the cursor

#### Scenario: Tier 3 — replacement characters present

- **WHEN** a splitter emits U+FFFD for a token that straddles a multi-byte sequence (e.g. tiktoken on emoji)
- **THEN** the part is anchored on its first anchorable grapheme, offset back to the part's own left edge

#### Scenario: Tier 3 positions the part's left edge

- **WHEN** a part's first anchorable grapheme sits `k` code units into the part, with `k` greater than zero
- **THEN** the part's `start` is the grapheme's match position minus `k`, so that `start + part.length` spans the source the part consumed

#### Scenario: Tier 3 rejects a candidate whose remaining code units do not align

- **WHEN** the anchor grapheme is found at an offset where some other non-invented code unit of the part does not match the source
- **THEN** that candidate is rejected and the search continues from the next occurrence of the anchor grapheme

#### Scenario: Tier 3 accepts the first candidate that does align

- **WHEN** a part that occurs verbatim in the source has its anchor grapheme occurring earlier than the part's true position
- **THEN** the earlier occurrence is rejected by verification and the part anchors at its true position

#### Scenario: Tier 2 skipped for a part containing U+FFFD

- **WHEN** a part contains U+FFFD, whether or not the source string contains one
- **THEN** Tier 2 is not attempted and the part is anchored by Tier 3

#### Scenario: Tier 2 skipped for a part the source cannot contain

- **WHEN** a part contains U+FFFD and the source string contains no U+FFFD
- **THEN** Tier 2 is not attempted and the part is anchored by Tier 3, yielding the same position it would have without the skip

#### Scenario: Tier 2 skipped even when the source itself contains U+FFFD

- **WHEN** a part contains U+FFFD and the source string also contains U+FFFD
- **THEN** Tier 2 is still not attempted, because a verbatim hit on a character the splitter invented carries no information about where the part came from

#### Scenario: Cursor advance is length-based in every tier

- **WHEN** a part has been located by any of the three tiers
- **THEN** `end` is `start + part.length` clamped to input length and the cursor advances to `end`

### Requirement: Anchoring cost is linear in input length

For a supported splitter, the system SHALL anchor parts in time linear in the length of the
input, for every chunk strategy, **whether or not the source contains U+FFFD**. No part SHALL
trigger a search whose outcome is already determined or whose result would not be trusted,
because a per-part search proportional to the remaining input makes the whole split
quadratic — a document that is 10x larger must not cost ~100x more to chunk.

Prior to this change the guarantee excluded a source containing U+FFFD, on the grounds that
a U+FFFD-bearing part is genuinely findable there so Tier 2 could not be skipped. Tier 2 is
skipped for such parts regardless of the source, for the correctness reasons in "Three-tier
locate strategy", and the unbounded per-part search goes with it.

One case still falls outside the guarantee by design. A splitter that mutates bytes without
emitting U+FFFD keeps the unbounded search, and is already unsupported for correctness
reasons (see "Mutating splitters are unsupported").

Within its scope this is a behavioral guarantee, not an implementation note: callers chunk
whole documents, and a quadratic term makes large multi-byte inputs unusable rather than
merely slow.

#### Scenario: Growing the input grows anchoring time proportionally

- **WHEN** the same U+FFFD-emitting tokenizer splitter is run in `character` strategy over inputs of size n and k·n
- **THEN** the time taken for k·n is roughly k times the time for n, not k² times

#### Scenario: Growing a U+FFFD-bearing input grows anchoring time proportionally

- **WHEN** the input given to that same splitter itself contains one or more literal U+FFFD characters
- **THEN** anchoring time still grows linearly with input length, because Tier 2 is skipped for U+FFFD-bearing parts either way

#### Scenario: An input whose parts are almost all unanchorable stays linear

- **WHEN** a splitter returns parts that are overwhelmingly nothing but U+FFFD
- **THEN** anchoring time still grows linearly with input length, rather than paying a per-part cost proportional to part length

### Requirement: Unanchorable parts are dropped but bytes preserved

When an entire part consists of U+FFFD and/or combining marks (nothing positionable), the
system SHALL silently drop that part while preserving its source bytes in chunk text,
because chunks span from their first part's `start` to their last part's `end` and gaps
between parts are absorbed forward.

#### Scenario: Fully unanchorable part

- **WHEN** a part contains only replacement characters and/or combining marks
- **THEN** the part is dropped from anchoring but the source code units it represented remain within the enclosing chunk's range

### Requirement: Mutating splitters are unsupported

Splitters MUST NOT transform token content. When a part's first anchorable grapheme cannot
be found in the source from the cursor onward, the system SHALL throw. When that grapheme
_is_ found but at a position unrelated to the part's true origin — the common case for a
lowercasing or accent-stripping splitter, whose mutated parts often still match some later
occurrence — the system SHALL anchor there, producing an incorrect position with no error.
Callers MUST NOT rely on a mutating splitter failing loudly.

#### Scenario: Anchorable but absent part

- **WHEN** a part's anchorable graphemes do not occur in the source from the cursor onward
- **THEN** `split` throws indicating the part could not be located in input

#### Scenario: Mutated part matches a later occurrence

- **WHEN** a lowercasing splitter emits `"hi"` for source `"Hi"` and a lowercase `h` occurs later in the input
- **THEN** the part anchors on that later `h`, yielding an incorrect `start` and no error

### Requirement: Anchoring positions parts, it does not police boundaries

Grapheme segmentation is used only to choose an anchor _inside a part_ during Tier 3. It
carries no guarantee about chunk boundaries. The system SHALL faithfully reproduce whatever
units the splitter returns, so when a splitter emits parts that are fragments of a grapheme
cluster — which the default `text.split('')` does for any astral character, one UTF-16 code
unit at a time — chunk boundaries MAY fall inside a grapheme cluster or between the halves of
a surrogate pair. Choosing units that are meaningful for the caller's model is the splitter's
responsibility, not the library's.

The positional contract still holds in that case: `chunk.text === getChunk(input, start, end)`
for every chunk, and coverage is unbroken.

#### Scenario: Default splitter over an astral character

- **WHEN** `split("👋🏻 hi", { chunkSize: 1 })` runs with the default character splitter
- **THEN** chunks carry individual UTF-16 code units, including lone surrogates, each with correct `start`/`end` and full coverage

### Requirement: Supported tokenizer boundary

The system SHALL correctly position any splitter whose decoded part length equals the source
span it consumed — including `text.split('')`, whitespace and sentence/line regex splitters,
and `tiktoken` (which substitutes exactly one U+FFFD per undecodable byte). This holds
whether or not the source itself contains literal U+FFFD, subject to the two stated
exceptions in "A literal U+FFFD in the source does not misdirect anchoring". Tokenizers whose
pipeline normalizes during decode (e.g. `gte-small`, `bge-small`, uncased WordPiece via
`@huggingface/transformers`) are a known limitation: they can inflate decoded length and
cause a throw or mis-anchoring. Expanding support for these is tracked as future work.

#### Scenario: Length-preserving tokenizer

- **WHEN** a splitter's decoded part length equals its consumed source span (char, whitespace, sentence, tiktoken)
- **THEN** every part anchors to a correct source position

#### Scenario: Length-preserving tokenizer over a source containing U+FFFD

- **WHEN** a length-preserving tokenizer such as `tiktoken` splits a source that contains one or more literal U+FFFD characters
- **THEN** no throw occurs, and every part anchors to a correct source position except as allowed by the two exceptions in "A literal U+FFFD in the source does not misdirect anchoring"

#### Scenario: Length-inflating tokenizer (known limitation)

- **WHEN** a normalizing embedding-model tokenizer produces a decoded part longer than its source span
- **THEN** the cursor may advance past the next real position, causing a throw or mis-anchor — the documented, tracked limitation

### Requirement: A literal U+FFFD in the source does not misdirect anchoring

A source string may itself contain U+FFFD — scraped and mojibake-recovered text routinely
does. The system SHALL NOT anchor a part on a U+FFFD that the splitter manufactured by
searching the source for it verbatim. For a splitter whose decoded part length equals its
consumed source span, the presence of a literal U+FFFD in the source SHALL NOT cause a throw
that the same input without that character would not produce, and SHALL NOT displace any
part from the position it would otherwise anchor to.

This is the correctness counterpart to the linearity requirement in "Anchoring cost is
linear in input length". Both stem from the same precondition, and both hold for a source
that contains U+FFFD rather than carving it out.

Two narrow exceptions apply, both stated rather than implied.

**Tier 1 may still match a manufactured bare U+FFFD.** Tier 1 tests only whether the source
begins with the part at the cursor, and at that position a manufactured bare U+FFFD is
byte-identical to a literal one. When a literal U+FFFD stands exactly at the cursor, a
manufactured bare part MAY anchor there. This adds a chunk boundary at that position and
attributes that one code unit to the wrong part; because the part and the character it
matched are both one code unit wide, the cursor advances by exactly the consumed span, so no
subsequent part is displaced and coverage is unaffected. The system SHALL NOT drift as a
result of such a match. Candidate verification does not reach this case, because Tier 1 fires
before Tier 3.

**A mixed part may still anchor on a decoy that verification cannot distinguish.** Candidate
verification (see "Three-tier locate strategy") rejects an offset where the part's
non-invented code units do not align, which resolves the common form of this exception. It
does not resolve every form: where an earlier offset happens to align on all of them — easier
the more of the part is U+FFFD, since those positions impose no constraint — the earlier
offset is accepted and the part anchors before its true position. Reaching this at all
requires a splitter whose dropped span contains a character that can also **begin** a part.
Multi-character string delimiters qualify — `text.split("\n\n")`, `text.split(". ")`,
`text.split("...")` — because a lone `\n` is not `"\n\n"`. Character-class regex splitters do
not, however many characters they drop: a part containing a class member would itself have
been split there, so no part can begin with a character the span contains. That rules out
`text.split(/[.!?]+/)` and `text.split(/\s+/)`; `text.split('')` and `tiktoken` drop nothing.

Where it occurs, the system SHALL still preserve coverage and the correspondence between a
chunk's text and its positions: the boundary moves earlier, so code units join the following
chunk rather than being lost.

**A part with no U+FFFD may anchor on a verbatim decoy, independent of this exception.** Tier 2
takes the first verbatim occurrence at or after the cursor, and where a splitter drops a
multi-character span that itself contains the part, that occurrence can precede the part's true
position — `text.split("...")` over `"…漢...é...."` anchors the final `"."` on the separator's
first `.` rather than the source's own. This is not a multibyte or U+FFFD behaviour: it needs no
replacement character anywhere and it predates candidate verification, which cannot address it
because a Tier 2 hit aligns at every position by construction. It is recorded here because the
same corpus surfaces both, and separating them is what keeps the U+FFFD residual measurable.
Coverage and the text-to-position correspondence hold in this case too. It cannot be closed from
the text, since every candidate offset tiles the source; the remedy is a splitter that reports its
own positions — see the `splitter-positions` capability.

#### Scenario: Manufactured U+FFFD does not match a literal one later in the source

- **WHEN** a tokenizer fragments a multi-byte character into parts that each decode to a bare U+FFFD, and the source also contains a literal U+FFFD at a later position
- **THEN** those manufactured parts are dropped as unanchorable rather than anchored on the literal U+FFFD, the cursor stays on real source, and every subsequent part anchors to its correct position

#### Scenario: A literal U+FFFD in the source does not cause a throw

- **WHEN** a length-preserving splitter runs over a source containing one or more literal U+FFFD characters
- **THEN** anchoring completes without a "could not be located in input" error

#### Scenario: A literal U+FFFD at the cursor may claim a manufactured bare part

- **WHEN** a manufactured bare U+FFFD part is tested at a cursor position where the source holds a literal U+FFFD
- **THEN** the part anchors there, adding a chunk boundary at that position, and every other part in the input still anchors to its correct position

#### Scenario: A verbatim mixed part after a dropped multi-character separator anchors correctly

- **WHEN** a paragraph or sentence splitter drops a multi-character separator and the following part mixes U+FFFD with real text, and that part's first anchorable grapheme also occurs inside the dropped separator
- **THEN** candidate verification rejects the occurrence inside the separator and the part anchors at its true offset

#### Scenario: A part whose replacement char is genuinely in the source anchors at its own left edge

- **WHEN** a splitter returns a part containing U+FFFD that appears verbatim in the source forward of the cursor, with no earlier occurrence of its first anchorable grapheme
- **THEN** the part anchors at that verbatim position

#### Scenario: Displacement never breaks coverage

- **WHEN** a part does anchor before its true position under the remaining exception
- **THEN** every code unit from the first chunk's start onward still appears in exactly one chunk, and each chunk's text still equals the source resliced at its own positions

### Requirement: Reported positions bypass the anchoring limitations

Every limitation of the locate strategy — the Tier 2 verbatim decoy, the Tier 3 candidate a
one-character skeleton cannot rule out, and the Tier 1 ambiguity between a manufactured and a
literal U+FFFD — is a consequence of inferring a position from text. A splitter that reports
positions (see the `splitter-positions` capability) SHALL NOT be subject to any of them, because
no inference is performed for a reported part.

The limitations SHALL continue to hold as stated for bare-string splitters. This requirement adds
a remedy; it does not narrow the exceptions.

#### Scenario: Tier 2 verbatim decoy with a reporting splitter

- **WHEN** a splitter drops a multi-character span containing a copy of the following part, and reports that part's position
- **THEN** the part anchors at its reported offset rather than at the earlier occurrence inside the dropped span

#### Scenario: Mostly-U+FFFD part with a reporting splitter

- **WHEN** a part carrying a single non-U+FFFD code unit is reported with its position
- **THEN** the reported offset is used and the candidate search that a one-character skeleton cannot verify is not performed

#### Scenario: Bare U+FFFD part with a reporting splitter

- **WHEN** a tokenizer that fragments a multi-byte character reports the position of each fragment, over a source that also contains a literal U+FFFD
- **THEN** each fragment anchors at its reported offset, so a manufactured part cannot claim the literal U+FFFD and no part is dropped as unanchorable
