## MODIFIED Requirements

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
requires a splitter that drops a **multi-character** span between parts, which includes
sentence and line/paragraph splitters such as `text.split(/[.!?]+/)` and
`text.split("\n\n")`; single-character droppers like `text.split(/\s+/)` cannot, and
`text.split('')` and `tiktoken` drop nothing.

Where it occurs, the system SHALL still preserve coverage and the correspondence between a
chunk's text and its positions: the boundary moves earlier, so code units join the following
chunk rather than being lost.

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
