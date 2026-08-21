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
 * @typedef {object} SplitOptions
 * @property {number} [chunkSize]
 * @property {number} [chunkOverlap]
 * @property {(input: string) => string[]} [splitter]
 * @property {"character"|"paragraph"} [chunkStrategy]
 */

const CHUNK_STRATEGIES = new Set(["character", "paragraph"]);
const REPLACEMENT_CHAR = "�";
// Parts that are nothing but replacement characters are the bulk of a
// tokenizer's unanchorable output on dense multi-byte text. One scan rules them
// out and skips an `Intl.Segmenter` pass that could only reach the same answer.
const ONLY_REPLACEMENT_CHARS = /^�+$/;
// A grapheme cluster with nothing positionable in it: replacement characters,
// which a splitter invents so the source may not contain them, and combining
// marks, which only ever appear merged into a preceding base grapheme. Both
// belong in one character class rather than two tests, because `Intl.Segmenter`
// merges a mark into a preceding U+FFFD base — `"�́"` is a single cluster
// that is neither a bare replacement char nor mark-only, and anchoring on it
// searches the source for a character the splitter manufactured.
const UNANCHORABLE_CLUSTER = /^[�\p{M}]+$/u;
// The only paragraph break `chunkStrategy: "paragraph"` recognizes — used for
// both the split and the per-paragraph cursor advance.
const PARAGRAPH_DELIMITER = "\n\n";
// Host default locale: grapheme segmentation per UAX #29 is locale-independent,
// verified identical across en, th, ja, ar, hi and und.
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
// Needed when the splitter mutated bytes: tiktoken decoding a token that
// straddles a multi-byte char emits U+FFFD, or emits an isolated combining
// mark that only ever appears merged into a preceding base grapheme.
/**
 * Returns the cluster together with its offset into `splitPart`, because the
 * cluster's position in the source is not the part's position unless that
 * offset is zero — see the tier 3 call site.
 *
 * @param {string} splitPart
 * @returns {{ segment: string, offset: number }|null}
 */
const firstAnchorGrapheme = (splitPart) => {
  // Fast path only — not the full unanchorable test. Keyed on the part being
  // nothing but replacement chars, not on merely containing one: a part mixing
  // U+FFFD with real text is still anchorable.
  if (ONLY_REPLACEMENT_CHARS.test(splitPart)) {
    return null;
  }

  for (const { segment, index } of SEGMENTER.segment(splitPart)) {
    // Whole clusters, not code units: a mark merges into whatever precedes it,
    // so a cluster anchors only if it holds something other than a replacement
    // char or a mark. `\p{M}` covers variation selectors FE00-FE0F.
    if (UNANCHORABLE_CLUSTER.test(segment)) {
      continue;
    }

    return { segment, offset: index };
  }

  // Reached when no single cluster anchors but the part was not caught above —
  // an isolated combining mark, or a mark alongside a replacement char.
  return null;
};

/**
 * Anchor splitter parts against a single source string, producing parts with
 * absolute (offset-adjusted) `start`/`end` positions.
 *
 * Three-tier locate strategy, cheapest first:
 *  1. `startsWith` at the current cursor — byte-preserving splitter with the
 *     cursor sitting exactly on the next part (char/tiktoken happy path).
 *  2. `indexOf(splitPart)` forward — byte-preserving splitter that drops
 *     bytes between parts (e.g. `text.split(/\s+/)` discards whitespace, so
 *     the cursor lands in the gap and `startsWith` fails). Skipped for every
 *     part containing U+FFFD. When the source has none, that is an
 *     equivalence: the part cannot be a substring, so the search could only
 *     fail after scanning to end of input, and with O(n) such parts that is
 *     quadratic. When the source does have one, it is a deliberate preference
 *     for tier 3 — U+FFFD is a character the splitter invented, so a verbatim
 *     hit on it says nothing about where the part came from, and acting on
 *     such a hit strands the cursor past real source. U+FFFD is the only
 *     character a splitter may introduce, so nothing else admits either
 *     inference.
 *  3. `indexOf(firstAnchorGrapheme(splitPart))` — byte-mutating splitter
 *     (e.g. tiktoken emitting U+FFFD across a multi-byte boundary); find the
 *     first positionable grapheme inside splitPart and anchor the part's left
 *     edge relative to it, correcting for that grapheme's offset into the
 *     part.
 *
 * `indexOf` is safe in tier 3 because `firstAnchorGrapheme` returns a whole
 * grapheme cluster, which never starts with a low surrogate or combining
 * mark — a code-unit match cannot land mid-surrogate or mid-cluster.
 *
 * Tier 1 remains unguarded, and cannot be: at the cursor a manufactured bare
 * U+FFFD is byte-identical to a literal one, so a literal U+FFFD standing
 * there may claim a manufactured part. That costs one chunk boundary and no
 * drift, since both are one code unit wide.
 *
 * @param {string} input
 * @param {(input: string) => string[]} splitter
 * @param {number} baseOffset
 * @returns {Chunk[]}
 */
const anchorParts = (input, splitter, baseOffset) => {
  const splits = splitter(input);
  if (!Array.isArray(splits)) {
    throw new TypeError(
      `Splitter must return an array of strings. Received: ${typeof splits}`,
    );
  }

  /** @type {Chunk[]} */
  const parts = [];
  let cursor = 0;

  for (const splitPart of splits) {
    if (typeof splitPart !== "string") {
      throw new Error(
        `Splitter returned a non-string part: ${splitPart} for input: ${input}`,
      );
    }

    if (splitPart.length === 0) {
      continue;
    }

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
        continue;
      }

      // The anchor cluster sits `anchor.offset` code units into the part, so
      // its match position is not the part's start — subtracting the offset is
      // what makes `end = start + splitPart.length` span the source the part
      // actually consumed. This is also what lets tier 2 be skipped for every
      // U+FFFD-bearing part above: without it, a mixed part like `"�b"`
      // anchors on its `"b"` one unit late, and the tier 2 exact match is the
      // only thing that hides it. Searching from `cursor + offset` keeps the
      // corrected start at or after the cursor.
      const match = input.indexOf(anchor.segment, cursor + anchor.offset);
      start = match === -1 ? -1 : match - anchor.offset;
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
 * what `indexOf` would have returned.
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
 * Code units between the splitter's anchored parts (whitespace stripped by
 * `split(/\s+/)`, paragraph `\n\n` delimiters, tokenizer-dropped multi-byte
 * fragments) are absorbed into the *previous* chunk by extending its `end`
 * forward to the next chunk's `start`. This means callers can rely on
 * positions to attribute every source code unit to a chunk — useful for
 * RAG citations, source highlighting, and re-chunking. The one exception
 * is code units before `chunks[0].start`, which have no previous chunk to
 * extend into and remain uncovered.
 *
 * Trade-off: chunk text may carry trailing whitespace or `\n\n` delimiters
 * absorbed from the gap. A caller who wants trimmed text can trim it
 * themselves — `chunk.text.trim()` for string input, or per element when
 * `text` is a `string[]`. The reverse (dropped content, want it back) would
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
export const split = /** @type {SplitFn} */ (
  /** @type {unknown} */ (splitImpl)
);
