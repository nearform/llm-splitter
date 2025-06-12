import type { SplitOptions, ChunkUnit } from './types'
import {
  canFitAllUnits,
  chunkByCharacter,
  chunkByGreedySlidingWindow,
  getLength,
  getUnits
} from './utils'

/**
 * Returns the substring from the input text(s) between start and end character positions (character-based only).
 * @param text - A string or array of strings.
 * @param start - Optional start character position (inclusive, default 0).
 * @param end - Optional end character position (exclusive, default: end of input).
 * @returns The substring(s) between start and end positions.
 */
export function getChunk(
  text: string | string[],
  start?: number,
  end?: number
): typeof text {
  if (typeof text === 'string') return text.slice(start, end)

  let currentLength: number = 0
  let startIndex: number | null = null
  let startOffset: number = 0
  let endIndex: number | null = null
  let endOffset: number = 0

  // Scan through the array to find start and end indices
  for (const [index, row] of text.entries()) {
    currentLength += row.length
    if (currentLength >= (start ?? 0) && startIndex === null) {
      startIndex = index
      startOffset = row.length - (currentLength - (start ?? 0))
    }
    if (currentLength > (end ?? Infinity)) {
      endIndex = index
      endOffset = row.length - (currentLength - (end ?? Infinity))
      break
    }
  }

  // If no start found return an empty array
  if (startIndex === null) return []

  // Expand to the end of the last string if no endIndex found
  if (endIndex === null) {
    endIndex = text.length - 1
    endOffset = text[endIndex].length
  }

  // If start and end are in the same string, return the substring
  if (startIndex === endIndex)
    return [text[startIndex].slice(startOffset, endOffset)]

  // Return the two-part array
  if (startIndex === endIndex - 1)
    return [
      text[startIndex].slice(startOffset),
      text[endIndex].slice(0, endOffset)
    ].filter(Boolean)

  // Return the entire chunk from start to end
  return [
    text[startIndex].slice(startOffset),
    ...text.slice(startIndex + 1, endIndex),
    text[endIndex].slice(0, endOffset)
  ].filter(Boolean)
}

/**
 * Synchronous generator version of split. Yields each chunk object as produced.
 * @param text - A string or array of strings to split.
 * @param options - Options object.
 * @yields Chunk object for each chunk.
 */
export function* iterateChunks(
  text: string | string[],
  {
    chunkSize = 512,
    chunkOverlap = 0,
    lengthFunction,
    chunkStrategy
  }: SplitOptions = {}
): Generator<string> {
  const texts: string[] = Array.isArray(text) ? text : [text]
  for (const currentText of texts)
    if (currentText.length === 0) yield ''
    else if (chunkStrategy === 'paragraph') {
      const chunkUnits: ChunkUnit[] = getUnits(currentText)
      const joiner: string = '\n\n'
      const joinerLen: number = getLength(joiner, lengthFunction)
      if (canFitAllUnits(chunkUnits, lengthFunction, chunkSize, joinerLen))
        for (const { unit } of chunkUnits) yield unit
      else
        yield* chunkByGreedySlidingWindow(
          chunkUnits,
          lengthFunction,
          joinerLen,
          chunkSize,
          joiner,
          chunkOverlap
        )
    } else
      // Default character-based chunking
      yield* chunkByCharacter(
        currentText,
        chunkSize,
        lengthFunction,
        chunkOverlap
      )
}

/**
 * Split text or array of texts for LLM vectorization using a sliding window approach.
 * Each chunk will overlap with the previous chunk by `chunkOverlap` characters (if provided).
 *
 * @param input - A string or array of strings to split.
 * @param options - Options object.
 * @returns Array of chunked strings.
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): string[] {
  return [...iterateChunks(text, options)]
}
