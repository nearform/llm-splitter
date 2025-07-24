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
export function getChunk(
  input: string | string[],
  start: number,
  end: number
): typeof input {
  const matches: string[] = []
  let offset: number = 0
  const inputs: string[] = Array.isArray(input) ? input : [input]

  for (const item of inputs) {
    // Error if not string.
    if (typeof item !== 'string')
      throw new TypeError(
        `Input must be a string or array of strings, got ${typeof item} for ${item}`
      )

    const itemLength: number = item.length
    const itemStart: number = offset
    const itemEnd: number = offset + itemLength

    // Check if this item overlaps with the requested chunk
    if (start < itemEnd && itemStart < end) {
      // Calculate the actual start and end positions within this item
      const chunkStart: number = Math.max(0, start - itemStart)
      const chunkEnd: number = Math.min(itemLength, end - itemStart)

      // Extract the substring from this item
      const chunk: string = item.substring(chunkStart, chunkEnd)
      matches.push(chunk)
    }

    offset += itemLength
  }

  // Return single string for single input, array for array input
  return Array.isArray(input) ? matches : matches[0] || ''
}
