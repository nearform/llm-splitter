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
  if (!CHUNK_STRATEGIES.has(chunkStrategy))
    throw new Error(
      `Invalid chunk strategy. Must be one of: ${[...CHUNK_STRATEGIES].join(", ")}`,
    );

  if (typeof chunkSize !== "number" || !Number.isInteger(chunkSize))
    throw new Error("Chunk size must be a positive integer");

  if (chunkSize < 1) throw new Error("Chunk size must be at least 1");

  if (typeof chunkOverlap !== "number" || !Number.isInteger(chunkOverlap))
    throw new Error(
      `Chunk overlap must be a non-negative integer. Found: ${chunkOverlap}`,
    );

  if (chunkOverlap < 0) throw new Error("Chunk overlap must be at least 0");

  if (chunkOverlap >= chunkSize)
    throw new Error("Chunk overlap must be less than chunk size");

  if (typeof splitter !== "function")
    throw new Error("Splitter must be a function");
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
    if (segment === REPLACEMENT_CHAR) continue;
    // Combining marks (including variation selectors FE00-FE0F, class Mn)
    // merge into a preceding base grapheme in real text — they have no
    // standalone position to anchor against.
    if (/^\p{M}+$/u.test(segment)) continue;
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
    if (segment === anchorGrapheme) return cursor + index;
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
    if (typeof splitPart !== "string")
      throw new Error(
        `Splitter returned a non-string part: ${splitPart} for input: ${input}`,
      );
    if (splitPart.length === 0) continue;

    let start;
    if (input.startsWith(splitPart, cursor)) {
      start = cursor;
    } else {
      const anchor = firstAnchorGrapheme(splitPart);
      // splitPart is entirely U+FFFD (tokenizer's decode emitted nothing
      // recognizable). It claims no source bytes — silently drop it.
      if (anchor === null) continue;
      start = findGrapheme(input, cursor, anchor);
      if (start === -1)
        throw new Error(
          `Splitter did not return any parts for input (${input.length}): "${input.slice(0, 20)}"... with part (${splitPart.length}): "${splitPart.slice(0, 20)}"...`,
        );
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
 * Group inputs into "boundary groups" per strategy. Parts within a group are
 * preferred to stay together in the same chunk; parts across groups can split
 * if a boundary is reached and the next group wouldn't fit.
 *
 * @param {string} strategy
 * @param {string[]} inputs
 * @returns {string[][]}
 */
const boundaryGroups = (strategy, inputs) => {
  if (strategy === "paragraph") {
    /** @type {string[][]} */
    const groups = [];
    for (const input of inputs)
      for (const paragraph of input.split(/\n\n/)) groups.push([paragraph]);
    return groups;
  }
  return [inputs];
};

/**
 * Split text into chunks.
 *
 * ## Chunk Structure
 * When input is an array, array boundaries are always token boundaries.
 * `start`/`end` are UTF-16 code-unit offsets into the joined input string.
 * Gaps between parts (e.g. whitespace dropped by `split(/\s+/)`) are absorbed
 * into `chunk.text` because `chunk.text === getChunk(input, chunk.start, chunk.end)`.
 *
 * ## Chunk Strategy
 * - `"character"` (default): pack as many tokens as fit.
 * - `"paragraph"`: keep paragraphs (split on `\n\n` or array boundaries) intact
 *   when possible; paragraphs larger than `chunkSize` are split across chunks.
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
  const inputAsString = inputAsArray.join("");
  const groups = boundaryGroups(chunkStrategy, inputAsArray);

  /** @type {Chunk[]} */
  const chunks = [];
  /** @type {Chunk[]} */
  let currentParts = [];
  let lastEmittedEnd = -1;
  let hasBoundary = false;
  let baseOffset = -1;

  const emit = () => {
    const start = currentParts[0].start;
    const end = currentParts[currentParts.length - 1].end;
    chunks.push({ text: getChunk(input, start, end), start, end });
    lastEmittedEnd = end;
    currentParts = chunkOverlap > 0 ? currentParts.slice(-chunkOverlap) : [];
    hasBoundary = false;
  };

  for (const group of groups) {
    if (group.length === 0) continue;

    // Locate this group's first non-empty element in the joined input so that
    // anchorParts() can offset its parts correctly.
    const firstPart = group[0];
    baseOffset = inputAsString.indexOf(firstPart, baseOffset + 1);
    if (baseOffset === -1)
      throw new Error(
        `Could not find start of group: ${group.slice(0, 20)}...`,
      );

    /** @type {Chunk[]} */
    const groupParts = [];
    let groupOffset = baseOffset;
    for (const groupInput of group) {
      for (const part of anchorParts(groupInput, splitter, groupOffset))
        groupParts.push(part);
      groupOffset += groupInput.length;
    }

    if (groupParts.length === 0) continue;

    // If the current chunk already has a boundary and adding this whole group
    // would overflow, emit now so the next chunk can hold the full group.
    if (
      hasBoundary &&
      currentParts.length > 0 &&
      currentParts.length + groupParts.length > chunkSize
    )
      emit();

    for (let i = 0; i < groupParts.length; i++) {
      const part = groupParts[i];
      currentParts.push(part);
      if (i === groupParts.length - 1) hasBoundary = true;

      if (currentParts.length === chunkSize) emit();
    }
  }

  // Final chunk: emit only if there are parts past the last emitted end.
  if (
    currentParts.length > 0 &&
    currentParts[currentParts.length - 1].end > lastEmittedEnd
  )
    emit();

  return chunks;
};
