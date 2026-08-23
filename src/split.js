import { getChunk } from "./get-chunk.js";

/**
 * `text` is whatever the caller passed to `split()`: a `string` for string
 * input, a `string[]` for array input. The default keeps a bare `Chunk`
 * meaning the union, so an annotation written without a type argument still
 * accepts either.
 *
 * @template {string|string[]} [T=string|string[]]
 * @typedef {object} Chunk
 * @property {T} text
 * @property {number} start
 * @property {number} end
 */

/**
 * One element of a splitter's return value. A bare string is positioned by the
 * three-tier locate strategy; the object form carries an offset the splitter
 * already knows, so nothing is inferred for that part. The two may be mixed.
 *
 * @typedef {string|{ text: string, start: number }} SplitterPart
 */

/**
 * @typedef {object} SplitOptions
 * @property {number} [chunkSize]
 * @property {number} [chunkOverlap]
 * @property {(input: string) => SplitterPart[]} [splitter]
 * @property {"character"|"paragraph"} [chunkStrategy]
 */

const CHUNK_STRATEGIES = new Set(["character", "paragraph"]);
const REPLACEMENT_CHAR = "�";
// Fast path: parts that are nothing but replacement chars are the bulk of a
// tokenizer's unanchorable output, and one scan skips an `Intl.Segmenter` pass.
const ONLY_REPLACEMENT_CHARS = /^�+$/;
// A grapheme cluster with nothing positionable in it. One character class, not
// two tests: `Intl.Segmenter` merges a mark into a preceding U+FFFD base, so
// `"�́"` is a single cluster that is neither bare-replacement nor mark-only.
const UNANCHORABLE_CLUSTER = /^[�\p{M}]+$/u;
// The only paragraph break `chunkStrategy: "paragraph"` recognizes — used for
// both the split and the per-paragraph cursor advance.
const PARAGRAPH_DELIMITER = "\n\n";
// Host default locale: UAX #29 grapheme segmentation is locale-independent,
// verified identical across en, th, ja, ar, hi and und.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * @param {{
 *   chunkSize: number
 *   chunkOverlap: number
 *   splitter: (input: string) => SplitterPart[]
 *   chunkStrategy: string
 * }} opts
 */
const splitValidate = ({
  chunkSize,
  chunkOverlap,
  splitter,
  chunkStrategy,
}) => {
  if (!CHUNK_STRATEGIES.has(chunkStrategy)) {
    throw new Error(
      `Invalid chunk strategy. Must be one of: ${[...CHUNK_STRATEGIES].join(", ")}`,
    );
  }

  if (typeof chunkSize !== "number" || !Number.isInteger(chunkSize)) {
    throw new Error(
      `Chunk size must be a positive integer. Found: ${chunkSize}`,
    );
  }

  if (chunkSize < 1) {
    throw new Error("Chunk size must be at least 1");
  }

  if (typeof chunkOverlap !== "number" || !Number.isInteger(chunkOverlap)) {
    throw new Error(
      `Chunk overlap must be a non-negative integer. Found: ${chunkOverlap}`,
    );
  }

  if (chunkOverlap < 0) {
    throw new Error("Chunk overlap must be at least 0");
  }

  if (chunkOverlap >= chunkSize) {
    throw new Error("Chunk overlap must be less than chunk size");
  }

  if (typeof splitter !== "function") {
    throw new Error("Splitter must be a function");
  }
};

/**
 * First grapheme of `splitPart` that can plausibly stand alone in `input`,
 * with its offset into the part — the cluster's position in the source is not
 * the part's position unless that offset is zero (see the tier 3 call site).
 *
 * Returns `null` when nothing in the part is positionable.
 *
 * @param {string} splitPart
 * @returns {{ segment: string, offset: number }|null}
 */
const firstAnchorGrapheme = (splitPart) => {
  // Fast path only, not the full unanchorable test: a part mixing U+FFFD with
  // real text is still anchorable.
  if (ONLY_REPLACEMENT_CHARS.test(splitPart)) {
    return null;
  }

  for (const { segment, index } of SEGMENTER.segment(splitPart)) {
    // Whole clusters, not code units: a mark merges into whatever precedes it.
    // `\p{M}` covers variation selectors FE00-FE0F.
    if (UNANCHORABLE_CLUSTER.test(segment)) {
      continue;
    }

    return { segment, offset: index };
  }

  return null;
};

/**
 * Does every code unit the splitter could not have invented line up with the
 * source at `at`? Rejects a tier 3 candidate whose anchor grapheme also occurs
 * inside the span the splitter dropped, so the search can walk forward instead
 * of trusting the first hit.
 *
 * U+FFFD and combining marks are skipped — the splitter may have manufactured
 * them, so they constrain nothing. That makes the check weakest for a part that
 * is mostly U+FFFD, which is where the residual mis-anchorings live.
 *
 * Comparing at fixed offsets rests on decoded length equalling the source span,
 * the same assumption as `end = start + splitPart.length`, so it adds none. It
 * is invalid for a length-inflating tokenizer; see `tokenizer-length-inflation`.
 *
 * @param {string} input
 * @param {string} splitPart
 * @param {number} at - Candidate left edge of `splitPart` in `input`.
 * @returns {boolean}
 */
const skeletonAligns = (input, splitPart, at) => {
  if (at < 0) {
    return false;
  }

  for (let i = 0; i < splitPart.length; i += 1) {
    const ch = splitPart[i];
    // Per code unit, not per cluster: `UNANCHORABLE_CLUSTER` is a character
    // class, so testing one unit is valid. If it ever becomes cluster-aware,
    // both call sites change.
    if (ch === REPLACEMENT_CHAR || UNANCHORABLE_CLUSTER.test(ch)) {
      continue;
    }

    if (at + i >= input.length || input[at + i] !== ch) {
      return false;
    }
  }

  return true;
};

/**
 * Normalize one element of a splitter's return value to `{ text, start }`,
 * where `start` is `null` for a bare string and the splitter's own offset for
 * a reported part.
 *
 * A reported offset is validated for *possibility*, not correctness: only
 * offsets that could not be right under any splitter are rejected — non-
 * integer, out of range, or behind the cursor. `text` is deliberately never
 * compared against the source at `start`, because a byte-mutating splitter
 * legitimately returns text differing from its source span.
 *
 * @param {SplitterPart} element
 * @param {string} input
 * @param {number} cursor - End of the previously placed part.
 * @returns {{ text: string, start: number|null }}
 */
const normalizePart = (element, input, cursor) => {
  if (typeof element === "string") {
    return { text: element, start: null };
  }

  if (element === null || typeof element !== "object") {
    throw new Error(
      `Splitter returned a non-string part: ${element} for input: ${input}`,
    );
  }

  const { text, start } = element;

  if (typeof text !== "string") {
    throw new TypeError(
      `Splitter reported a part whose text is not a string: ${text} for input: ${input}`,
    );
  }

  if (!Number.isInteger(start) || start < 0 || start > input.length) {
    throw new TypeError(
      `Splitter reported start ${start} for part: "${text}", outside the input of length ${input.length}`,
    );
  }

  // A start behind the cursor overlaps the previous part, producing overlap
  // `chunkOverlap` never asked for. Clamping would hide a splitter bug.
  if (start < cursor) {
    throw new TypeError(
      `Splitter reported start ${start} for part: "${text}", behind the previous part's end ${cursor}`,
    );
  }

  return { text, start };
};

/**
 * Infer where `splitPart` sits in `input`, at or after `cursor`. Returns
 * `null` when the part holds nothing positionable and should be dropped, and
 * throws when it holds something positionable that is nowhere to be found.
 *
 * This is the inference a reported position replaces: every limitation below
 * is a consequence of guessing an offset from text alone.
 *
 * Three tiers, cheapest first:
 *  1. `startsWith` at the cursor — byte-preserving splitter with the cursor
 *     sitting exactly on the next part (char/tiktoken happy path).
 *  2. `indexOf(splitPart)` forward — byte-preserving splitter that drops bytes
 *     between parts (`text.split(/\s+/)` discards whitespace, so the cursor
 *     lands in the gap and `startsWith` fails). **Skipped for every part
 *     containing U+FFFD.** With no U+FFFD in the source that is an equivalence
 *     — the part cannot be a substring, so the search could only scan to end of
 *     input, quadratic over O(n) such parts. With one in the source it is a
 *     correctness choice: U+FFFD is a character the splitter invented, so a
 *     verbatim hit says nothing about origin and strands the cursor past real
 *     source.
 *  3. `indexOf(firstAnchorGrapheme(splitPart))` — byte-mutating splitter.
 *     Anchor the part's left edge relative to its first positionable grapheme,
 *     correcting for that grapheme's offset into the part. Each occurrence is
 *     only a candidate, accepted once `skeletonAligns` confirms it.
 *
 * The tier 3 *match* cannot land mid-surrogate or mid-cluster, since a grapheme
 * cluster never starts with a low surrogate or combining mark. That is a claim
 * about the match, not about `start`: subtracting the anchor's offset can put
 * `start` inside a surrogate pair, consistent with chunk boundaries carrying no
 * code-point integrity guarantee.
 *
 * Tier 1 is unguarded and cannot be: at the cursor a manufactured bare U+FFFD
 * is byte-identical to a literal one, so a literal U+FFFD standing there may
 * claim a manufactured part. Costs one chunk boundary and no drift.
 *
 * @param {string} input
 * @param {string} splitPart
 * @param {number} cursor
 * @returns {number|null}
 */
const locatePart = (input, splitPart, cursor) => {
  // Tier 1: cursor already at the part. Tier 2: search forward, unless the
  // part carries a U+FFFD the source cannot contain (see docstring).
  let start = -1;
  if (input.startsWith(splitPart, cursor)) {
    start = cursor;
  } else if (!splitPart.includes(REPLACEMENT_CHAR)) {
    start = input.indexOf(splitPart, cursor);
  }

  if (start === -1) {
    // Tier 3: byte-mutating splitter — locate via first anchor grapheme.
    const anchor = firstAnchorGrapheme(splitPart);
    // Entirely U+FFFD or combining marks: nothing positionable, so the part
    // claims no source bytes and is dropped.
    if (anchor === null) {
      return null;
    }

    // Subtracting `anchor.offset` is what makes `end = start + length` span
    // the source the part consumed; without it a mixed part like `"�b"`
    // anchors on its `"b"` one unit late. Searching from `cursor + offset`
    // keeps the corrected start at or after the cursor. The first occurrence
    // is only a candidate — the anchor grapheme can also occur inside the span
    // the splitter dropped, so verify before accepting.
    let match = input.indexOf(anchor.segment, cursor + anchor.offset);
    while (
      match !== -1 &&
      !skeletonAligns(input, splitPart, match - anchor.offset)
    ) {
      match = input.indexOf(anchor.segment, match + 1);
    }
    start = match === -1 ? -1 : match - anchor.offset;
    if (start === -1) {
      throw new Error(
        `Splitter returned a part that could not be located in input (${input.length}): "${input.slice(0, 20)}"... with part (${splitPart.length}): "${splitPart.slice(0, 20)}"...`,
      );
    }
  }

  return start;
};

/**
 * Anchor splitter parts against a single source string, producing parts with
 * absolute (offset-adjusted) `start`/`end` positions.
 *
 * Reported offsets are used as given; bare strings go to `locatePart`. Both
 * forms share one `end` computation and one cursor advance, so the coverage
 * contract holds across a mixture of the two.
 *
 * @param {string} input
 * @param {(input: string) => SplitterPart[]} splitter
 * @param {number} baseOffset
 * @returns {Chunk[]}
 */
const anchorParts = (input, splitter, baseOffset) => {
  const splits = splitter(input);
  if (!Array.isArray(splits)) {
    throw new TypeError(
      `Splitter must return an array of strings or { text, start } parts. Received: ${typeof splits}`,
    );
  }

  /** @type {Chunk[]} */
  const parts = [];
  let cursor = 0;

  for (const element of splits) {
    const { text: splitPart, start: reported } = normalizePart(
      element,
      input,
      cursor,
    );

    if (splitPart.length === 0) {
      continue;
    }

    // A reported offset skips all three tiers.
    const start =
      reported === null ? locatePart(input, splitPart, cursor) : reported;
    if (start === null) {
      continue;
    }

    const end = Math.min(start + splitPart.length, input.length);
    parts.push({
      text: splitPart,
      start: baseOffset + start,
      end: baseOffset + end,
    });
    cursor = end;
  }

  return parts;
};

/**
 * @typedef {object} BoundaryGroup
 * @property {number} baseOffset - Absolute position of `parts[0]` in joined input.
 * @property {string[]} parts
 */

/**
 * Group inputs into "boundary groups" per strategy. Parts within a group are
 * preferred to stay together in the same chunk; parts across groups can split
 * if a boundary is reached and the next group wouldn't fit.
 *
 * Each group carries its absolute `baseOffset`, computed arithmetically rather
 * than recovered by searching. That is what keeps paragraph mode correct when a
 * paragraph's content also appears inside an earlier one.
 *
 * @param {string} strategy
 * @param {string[]} inputs
 * @returns {BoundaryGroup[]}
 */
const boundaryGroups = (strategy, inputs) => {
  if (strategy === "paragraph") {
    /** @type {BoundaryGroup[]} */
    const groups = [];
    let elementStart = 0;
    for (const input of inputs) {
      let cursor = 0;
      for (const paragraph of input.split(PARAGRAPH_DELIMITER)) {
        // Trim to real content and shift baseOffset to match, so chunk starts
        // don't land on whitespace. The trimmed code units are absorbed by the
        // forward-extension pass below.
        const leadingMatch = paragraph.match(/^\s+/);
        const leadLen = leadingMatch ? leadingMatch[0].length : 0;
        const trailingMatch = paragraph.match(/\s+$/);
        const trailLen = trailingMatch ? trailingMatch[0].length : 0;
        const trimmed = paragraph.slice(leadLen, paragraph.length - trailLen);
        groups.push({
          baseOffset: elementStart + cursor + leadLen,
          parts: [trimmed],
        });

        // Pre-trim length, because these are positions in the original input,
        // and `PARAGRAPH_DELIMITER` is the only thing the split consumed.
        cursor += paragraph.length + PARAGRAPH_DELIMITER.length;
      }

      elementStart += input.length;
    }

    return groups;
  }

  return [{ baseOffset: 0, parts: inputs }];
};

/**
 * Split text into chunks.
 *
 * ## Chunk structure
 * - `start`/`end` are UTF-16 code-unit offsets into the joined input string.
 * - When input is an array, array boundaries are always token boundaries —
 *   a token never spans two array elements.
 * - `chunk.text === getChunk(input, chunk.start, chunk.end)`: the returned
 *   text is exactly what the positions point to.
 *
 * ## Coverage / position semantics
 * From `chunks[0].start` onward, every UTF-16 code unit of the source
 * appears in exactly one chunk (modulo `chunkOverlap`, which causes
 * adjacent chunks to overlap by `chunkOverlap` *parts*):
 * - `chunks[i].end >= chunks[i+1].start` for adjacent pairs.
 * - `chunks[chunks.length - 1].end === total input length`.
 *
 * Code units between anchored parts (whitespace stripped by `split(/\s+/)`,
 * paragraph `\n\n` delimiters, tokenizer-dropped fragments) are absorbed into
 * the *previous* chunk by extending its `end` forward, so callers can attribute
 * every source code unit to a chunk — RAG citations, source highlighting,
 * re-chunking. The one exception is code units before `chunks[0].start`, which
 * have no previous chunk to extend into.
 *
 * Trade-off: chunk text may carry trailing whitespace or `\n\n` absorbed from
 * the gap. A caller who wants trimmed text can trim it; the reverse would
 * require re-reading source, so the library prefers lossless.
 *
 * ## chunkSize
 * Counts splitter *parts*, not code units or graphemes. With multi-byte content
 * it may *undercount* if the tokenizer drops un-anchorable parts (see the
 * README's Multibyte section).
 *
 * ## Chunk strategies
 * - `"character"` (default): pack as many parts as fit per chunk.
 * - `"paragraph"`: prefer to keep paragraphs (split on `\n\n` or array
 *   boundaries) intact; paragraphs larger than `chunkSize` are split
 *   across chunks. Leading and trailing whitespace inside each paragraph
 *   is stripped before anchoring, so chunk *starts* land on real content.
 *
 * @param {string|string[]} input
 * @param {SplitOptions} [options]
 * @returns {Chunk<string|string[]>[]}
 */
const splitImpl = (
  input,
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter = (text) => text.split(""),
    chunkStrategy = "character",
  } = {},
) => {
  splitValidate({ chunkSize, chunkOverlap, splitter, chunkStrategy });

  if (typeof input !== "string" && !Array.isArray(input)) {
    throw new TypeError(
      `Input must be a string or array of strings. Received: ${typeof input}`,
    );
  }
  const inputAsArray = Array.isArray(input) ? input : [input];
  for (const item of inputAsArray) {
    if (typeof item !== "string") {
      throw new TypeError(
        `Input array elements must be strings. Found: ${typeof item}`,
      );
    }
  }
  const groups = boundaryGroups(chunkStrategy, inputAsArray);

  /** @type {Chunk[]} */
  const chunks = [];
  /** @type {Chunk[]} */
  let currentParts = [];
  let lastEmittedEnd = -1;
  let hasBoundary = false;

  const emit = () => {
    const start = currentParts[0].start;
    const end = currentParts[currentParts.length - 1].end;
    chunks.push({ text: getChunk(input, start, end), start, end });
    lastEmittedEnd = end;
    currentParts = chunkOverlap > 0 ? currentParts.slice(-chunkOverlap) : [];
    // Any boundary reached on the just-emitted chunk is consumed by it;
    // carried-over overlap parts are interior to the next chunk.
    hasBoundary = false;
  };

  for (const group of groups) {
    if (group.parts.length === 0) {
      continue;
    }

    /** @type {Chunk[]} */
    const groupParts = [];
    let groupOffset = group.baseOffset;
    for (const groupInput of group.parts) {
      for (const part of anchorParts(groupInput, splitter, groupOffset)) {
        groupParts.push(part);
      }
      groupOffset += groupInput.length;
    }

    if (groupParts.length === 0) {
      continue;
    }

    // If the current chunk already has a boundary and adding this whole group
    // would overflow, emit now so the next chunk can hold the full group.
    if (
      hasBoundary &&
      currentParts.length > 0 &&
      currentParts.length + groupParts.length > chunkSize
    ) {
      emit();
    }

    for (let i = 0; i < groupParts.length; i++) {
      const part = groupParts[i];
      currentParts.push(part);
      if (i === groupParts.length - 1) {
        hasBoundary = true;
      }

      if (currentParts.length === chunkSize) {
        emit();
      }
    }
  }

  // Final chunk: emit only if there are parts past the last emitted end.
  if (
    currentParts.length > 0 &&
    currentParts[currentParts.length - 1].end > lastEmittedEnd
  ) {
    emit();
  }

  // Extend each chunk's `end` to the next chunk's `start`, and the last to end
  // of input, so every code unit from chunks[0].start on is attributable — see
  // "Coverage / position semantics" above. Code units before chunks[0].start
  // have no previous chunk and stay uncovered.
  const totalLength = inputAsArray.reduce((sum, s) => sum + s.length, 0);
  for (let i = 0; i < chunks.length; i++) {
    const nextStart = i < chunks.length - 1 ? chunks[i + 1].start : totalLength;
    if (chunks[i].end < nextStart) {
      chunks[i] = {
        text: getChunk(input, chunks[i].start, nextStart),
        start: chunks[i].start,
        end: nextStart,
      };
    }
  }

  return chunks;
};

/**
 * Call signatures for `split`, so `chunk.text` narrows to the caller's own
 * input type instead of forcing every consumer to re-narrow the union.
 *
 * The union signature is kept **last and is not optional**: without it, a
 * caller holding a `string | string[]` variable matches neither narrow
 * signature and stops compiling. With it, both the narrowed and the union
 * call sites resolve.
 *
 * @typedef {{
 *   (input: string, options?: SplitOptions): Chunk<string>[];
 *   (input: string[], options?: SplitOptions): Chunk<string[]>[];
 *   (input: string|string[], options?: SplitOptions): Chunk<string|string[]>[];
 * }} SplitFn
 */

/**
 * Split text into size-bounded chunks that carry their source positions.
 *
 * See `splitImpl` above for the full contract — coverage semantics, chunk
 * structure, `chunkSize` units, and the two chunk strategies.
 *
 * The cast is required because the implementation returns the union form,
 * which is not assignable to the narrowed signatures even though every call
 * site is sound. `@overload` is not an option here: it applies to `function`
 * declarations, not to a `const` bound to an arrow function.
 */
export const split = /** @type {SplitFn} */ (splitImpl);
