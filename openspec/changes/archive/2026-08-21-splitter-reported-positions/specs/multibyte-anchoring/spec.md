## ADDED Requirements

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
