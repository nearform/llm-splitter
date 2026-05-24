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
export function getChunk(input, start, end) {
  /** @type {string[]} */
  const matches = []
  let offset = 0
  const inputs = Array.isArray(input) ? input : [input]

  for (const item of inputs) {
    // Error if not string.
    if (typeof item !== 'string')
      throw new TypeError(
        `Input must be a string or array of strings, got ${typeof item} for ${item}`
      )

    const itemLength = item.length
    const itemStart = offset
    const itemEnd = offset + itemLength

    // Check if this item overlaps with the requested chunk
    if (start < itemEnd && itemStart < end) {
      // Calculate the actual start and end positions within this item
      const chunkStart = Math.max(0, start - itemStart)
      const chunkEnd = Math.min(itemLength, end - itemStart)

      // Extract the substring from this item
      const chunk = item.substring(chunkStart, chunkEnd)
      matches.push(chunk)
    }

    offset += itemLength
  }

  // Return single string for single input, array for array input
  return Array.isArray(input) ? matches : matches[0] || ''
}
