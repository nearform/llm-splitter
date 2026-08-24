/**
 * Get the text of a chunk from positional parameters.
 *
 * Note that for arrays, the returned result will be an array and that the first and/or last
 * element of the array may be a substring of that array item's text.
 *
 * @param {string|string[]} input - The input (string or array of strings) to split.
 * @param {number} start - The start of the chunk.
 * @param {number} end - The end of the chunk.
 * @returns {string|string[]} The text or array of texts of the chunk.
 */
const getChunkImpl = (input, start, end) => {
  /** @type {string[]} */
  const matches = [];
  let offset = 0;
  const inputs = Array.isArray(input) ? input : [input];

  for (const item of inputs) {
    if (typeof item !== "string") {
      throw new TypeError(
        `Input must be a string or array of strings, got ${typeof item} for ${item}`,
      );
    }

    const itemLength = item.length;
    const itemStart = offset;
    const itemEnd = offset + itemLength;

    if (start < itemEnd && itemStart < end) {
      // Clamp the requested range to this item's own bounds.
      const chunkStart = Math.max(0, start - itemStart);
      const chunkEnd = Math.min(itemLength, end - itemStart);
      matches.push(item.substring(chunkStart, chunkEnd));
    }

    offset += itemLength;
  }

  return Array.isArray(input) ? matches : matches[0] || "";
};

/**
 * Call signatures for `getChunk`, mirroring `split`'s so the two agree: the
 * return type follows the caller's input type. The union signature is last and
 * is not optional — for the same reason as `SplitFn`, a caller holding a
 * `string | string[]` variable must still resolve.
 *
 * @typedef {{
 *   (input: string, start: number, end: number): string;
 *   (input: string[], start: number, end: number): string[];
 *   (input: string|string[], start: number, end: number): string|string[];
 * }} GetChunkFn
 */

/**
 * Get the text of a chunk from positional parameters. See `getChunkImpl` above
 * for the contract.
 *
 * The cast is required because the implementation returns the union form,
 * which is not assignable to the narrowed signatures even though every call
 * site is sound.
 */
export const getChunk = /** @type {GetChunkFn} */ (getChunkImpl);
