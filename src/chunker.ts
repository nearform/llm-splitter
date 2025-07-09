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

  // Iterate through array elements to locate start and end boundaries
  for (const [index, row] of text.entries()) {
    currentLength += row.length
    // Mark the first array element containing the start position
    if (currentLength >= (start ?? 0) && startIndex === null) {
      startIndex = index
      startOffset = row.length - (currentLength - (start ?? 0))
    }
    // Mark the first array element that exceeds the end position
    if (currentLength > (end ?? Infinity)) {
      endIndex = index
      endOffset = row.length - (currentLength - (end ?? Infinity))
      break
    }
  }

  // Return empty array when start position is beyond the input text
  if (startIndex === null) return []

  // Set end boundary to the last element when no explicit end is found
  if (endIndex === null) {
    endIndex = text.length - 1
    endOffset = text[endIndex].length
  }

  // Extract substring when start and end positions are within the same element
  if (startIndex === endIndex)
    return [text[startIndex].slice(startOffset, endOffset)]

  // Handle extraction spanning exactly two adjacent elements
  if (startIndex === endIndex - 1)
    return [
      text[startIndex].slice(startOffset),
      text[endIndex].slice(0, endOffset)
    ].filter(Boolean)

  // Extract content spanning multiple elements
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
    splitter = (text: string) => text.split(''),
    chunkStrategy
  }: SplitOptions = {}
): Generator<ChunkResult> {
  // Normalize input to array format for consistent processing
  const texts: string[] = Array.isArray(text) ? text : [text]
  let globalOffset: number = 0

  for (const currentText of texts) {
    // Handle empty text segments by yielding empty chunks
    if (currentText.length === 0)
      yield {
        text: Array.isArray(text) ? [''] : '',
        start: globalOffset,
        end: globalOffset
      }
    else if (chunkStrategy === 'paragraph') {
      // Extract paragraph units for semantic chunking
      const chunkUnits: ChunkUnit[] = getUnits(currentText)

      const chunks: ChunkResult[] = chunkByParagraph(
        chunkUnits,
        splitter,
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
      // Apply character-based chunking as the default strategy
      const chunks: ChunkResult[] = chunkByCharacter(
        currentText,
        chunkSize,
        splitter,
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

    // Update global position tracker for next text segment
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
