import { getChunk } from "./get-chunk.js";

/**
 * @typedef {object} Chunk
 * @property {string|string[]} text
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} SplitOptions
 * @property {number} [chunkSize]
 * @property {number} [chunkOverlap]
 * @property {(input: string) => string[]} [splitter]
 * @property {"character"|"paragraph"} [chunkStrategy]
 */

const CHUNK_STRATEGIES = new Set(["character", "paragraph"]);
const REPLACEMENT_CHAR = "�";
// Single source of truth for what counts as a paragraph break in
// `chunkStrategy: "paragraph"`. Currently a literal "\n\n"; in the future
// this may expand to an array of delimiters or accept user input.
const PARAGRAPH_DELIMITER = "\n\n";
// Locale `undefined` resolves to the host default, but grapheme segmentation
// per UAX #29 is locale-independent in practice — verified against en, th,
// ja, ar, hi, und and the host default on every multilingual fixture in the
// test suite; outputs were identical for all.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * @param {{
 *   chunkSize: number
 *   chunkOverlap: number
 *   splitter: (input: string) => string[]
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

// First grapheme of `splitPart` that can plausibly stand alone in `input`.
// Used when fast-path `startsWith` fails because the splitter mutated bytes
// (typically: tiktoken decoded a token straddling a multi-byte char and
// emitted U+FFFD, or emitted an isolated combining mark like a variation
// selector that only ever appears merged into a preceding base grapheme).
/**
 * @param {string} splitPart
 * @returns {string|null}
 */
const firstAnchorGrapheme = (splitPart) => {
  for (const { segment } of SEGMENTER.segment(splitPart)) {
    if (segment === REPLACEMENT_CHAR) {
      continue;
    }

    // Combining marks (including variation selectors FE00-FE0F, class Mn)
    // merge into a preceding base grapheme in real text — they have no
    // standalone position to anchor against.
    if (/^\p{M}+$/u.test(segment)) {
      continue;
    }

    return segment;
  }
  return null;
};

/**
 * Find `anchorGrapheme` in `input` at or after `cursor`, as a grapheme (not a
 * substring), so we don't land mid-surrogate.
 *
 * @param {string} input
 * @param {number} cursor
 * @param {string} anchorGrapheme
 * @returns {number} position in input (>= cursor), or -1.
 */
const findGrapheme = (input, cursor, anchorGrapheme) => {
  for (const { segment, index } of SEGMENTER.segment(input.slice(cursor))) {
    if (segment === anchorGrapheme) {
      return cursor + index;
    }
  }

  return -1;
};

/**
 * Anchor splitter parts against a single source string, producing parts with
 * absolute (offset-adjusted) `start`/`end` positions.
 *
 * @param {string} input
 * @param {(input: string) => string[]} splitter
 * @param {number} baseOffset
 * @returns {Chunk[]}
 */
const anchorParts = (input, splitter, baseOffset) => {
  /** @type {Chunk[]} */
  const parts = [];
  let cursor = 0;

  for (const splitPart of splitter(input)) {
    if (typeof splitPart !== "string") {
      throw new Error(
        `Splitter returned a non-string part: ${splitPart} for input: ${input}`,
      );
    }

    if (splitPart.length === 0) {
      continue;
    }

    let start;
    if (input.startsWith(splitPart, cursor)) {
      start = cursor;
    } else {
      const anchor = firstAnchorGrapheme(splitPart);
      // splitPart is entirely U+FFFD or combining marks (tokenizer's decode
      // emitted nothing positionable). It claims no source bytes — silently
      // drop it.
      if (anchor === null) {
        continue;
      }

      start = findGrapheme(input, cursor, anchor);
      if (start === -1) {
        throw new Error(
          `Splitter returned a part that could not be located in input (${input.length}): "${input.slice(0, 20)}"... with part (${splitPart.length}): "${splitPart.slice(0, 20)}"...`,
        );
      }
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
 * Each group carries its absolute `baseOffset` in the joined input string so
 * callers don't need to recover it by searching. This is what makes paragraph
 * mode robust against adversarial inputs where a paragraph's content appears
 * as a substring inside an earlier paragraph or where empty elements shift
 * what `indexOf` would have returned (B1, B2).
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
        // B6: trim leading/trailing whitespace from the paragraph and shift
        // baseOffset to match the trimmed content. The trimmed bytes still
        // exist in the input string — they end up in adjacent chunks via the
        // B5 forward-extension pass (or remain uncovered if they precede
        // chunks[0].start).
        const leadingMatch = paragraph.match(/^\s+/);
        const leadLen = leadingMatch ? leadingMatch[0].length : 0;
        const trailingMatch = paragraph.match(/\s+$/);
        const trailLen = trailingMatch ? trailingMatch[0].length : 0;
        const trimmed = paragraph.slice(leadLen, paragraph.length - trailLen);
        groups.push({
          baseOffset: elementStart + cursor + leadLen,
          parts: [trimmed],
        });

        // `PARAGRAPH_DELIMITER` is the only delimiter `split()` consumes, so
        // adjacent paragraphs are separated by exactly its length in source.
        // Use the pre-trim paragraph length to advance — we're tracking
        // positions in the original input.
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
 * From `chunks[0].start` onward, every source byte appears in exactly one
 * chunk (modulo `chunkOverlap`, which causes adjacent chunks to overlap by
 * `chunkOverlap` *parts*):
 * - `chunks[i].end >= chunks[i+1].start` for adjacent pairs.
 * - `chunks[chunks.length - 1].end === total input length`.
 *
 * Gap bytes between the splitter's anchored parts (whitespace stripped by
 * `split(/\s+/)`, paragraph `\n\n` delimiters, tokenizer-dropped multi-byte
 * fragments) are absorbed into the *previous* chunk by extending its `end`
 * forward to the next chunk's `start`. This means callers can rely on
 * positions to attribute every source byte to a chunk — useful for RAG
 * citations, source highlighting, and re-chunking. The one exception is
 * bytes before `chunks[0].start`, which have no previous chunk to extend
 * into and remain uncovered.
 *
 * Trade-off: chunk text may carry trailing whitespace or `\n\n` delimiters
 * absorbed from the gap. A caller who wants trimmed text can call
 * `chunk.text.trim()`; the reverse (dropped bytes, want them back) would
 * require re-reading source. The library prefers lossless.
 *
 * ## chunkSize
 * `chunkSize` counts splitter *parts*, not code units or graphemes. With
 * multi-byte content the part-count may *undercount* relative to user
 * expectation if the tokenizer drops un-anchorable parts (see Multibyte
 * section in README).
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
 * @returns {Chunk[]}
 */
export const split = (
  input,
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter = (text) => text.split(""),
    chunkStrategy = "character",
  } = {},
) => {
  splitValidate({ chunkSize, chunkOverlap, splitter, chunkStrategy });

  const inputAsArray = Array.isArray(input) ? input : [input];
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

  // B5: extend each chunk's `end` forward to absorb gaps to the next chunk;
  // the final chunk extends to end of input. Leading bytes before chunks[0]
  // are intentionally left uncovered (no "previous" chunk to extend).
  //
  // Why we preserve gap bytes rather than dropping them: chunks return
  // {start,end} positions so callers can locate them in the source. Coverage
  // means `chunks[i].end >= chunks[i+1].start` (modulo overlap) and
  // `chunks[last].end === input.length` — a downstream consumer can attribute
  // every source byte to a chunk for RAG citations, highlighting,
  // re-chunking, etc. Dropping bytes would make positions ambiguous and
  // citation ranges disjoint. Callers who want trimmed text can always do
  // `chunk.text.trim()`; the reverse (we trim, they want it back) is
  // impossible without re-reading source. Lossless library, lossy caller.
  //
  // Consequence: chunks have clean starts (B6 strips paragraph-leading
  // whitespace before anchoring) but may carry trailing whitespace and
  // `\n\n` delimiters that B5 absorbs forward from the gap.
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
