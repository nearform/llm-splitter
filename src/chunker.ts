import type { SplitOptions, ChunkUnit, ChunkResult } from './types.js'
import { chunkByCharacter, chunkByParagraph, getUnits } from './utils.js'

/**
 * Extracts a substring or segments from the input text by character positions.
 * For string input, returns a substring. For array input, returns relevant segments.
 *
 * @param text - A string or array of strings to extract from.
 * @param start - Starting character position (inclusive, default: 0).
 * @param end - Ending character position (exclusive, default: end of input).
 * @returns The substring for string input, or array of segments for array input.
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
 * Memory-efficient generator that yields chunks one at a time.
 * Supports both string and array inputs with consistent output format.
 *
 * @param text - A string or array of strings to split into chunks.
 * @param options - Configuration options for chunking behavior.
 * @yields Chunk objects with text content and character position metadata.
 */
export function* iterateChunks(
  text: string | string[],
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter,
    chunkStrategy
  }: SplitOptions = {}
): Generator<ChunkResult> {
  const texts: string[] = Array.isArray(text) ? text : [text]
  let globalOffset = 0

  for (const currentText of texts) {
    if (currentText.length === 0)
      yield {
        text: Array.isArray(text) ? [''] : '',
        start: globalOffset,
        end: globalOffset
      }
    else if (chunkStrategy === 'paragraph') {
      const chunkUnits: ChunkUnit[] = getUnits(currentText)

      const chunks = chunkByParagraph(
        chunkUnits,
        splitter || ((text: string) => text.split('')),
        chunkSize,
        chunkOverlap
      )
      for (const chunk of chunks)
        yield {
          text: Array.isArray(text)
            ? [chunk.text as string]
            : (chunk.text as string),
          start: globalOffset + chunk.start,
          end: globalOffset + chunk.end
        }
    } else {
      // Default character-based chunking
      const chunks = chunkByCharacter(
        currentText,
        chunkSize,
        splitter || ((text: string) => text.split('')),
        chunkOverlap,
        globalOffset
      )
      for (const chunk of chunks)
        yield {
          text: Array.isArray(text)
            ? [chunk.text as string]
            : (chunk.text as string),
          start: chunk.start,
          end: chunk.end
        }
    }

    globalOffset += currentText.length
  }
}

/**
 * Splits text or array of texts into chunks optimized for LLM vectorization.
 * Uses paragraph-based chunking with automatic sub-chunking of long paragraphs.
 * Supports token-based size calculation and configurable overlap.
 *
 * @param text - A string or array of strings to split into chunks.
 * @param options - Configuration options for chunking behavior.
 * @returns Array of chunk objects with text content and character position metadata.
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): ChunkResult[] {
  return [...iterateChunks(text, options)]
}
