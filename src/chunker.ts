import type { SplitOptions, ChunkUnit, ChunkResult } from './types.js'
import { chunkByCharacter, chunkByParagraph, getUnits } from './utils.js'

/**
 * Extracts a chunk of text from the input by character positions, preserving input type.
 *
 * For string input, returns a substring using slice(). For array input, returns an array
 * of string segments that span the specified character range across multiple array elements.
 * Uses precise character position calculations to determine which array elements to include
 * and how to slice them at boundaries.
 *
 * **Array Processing Logic:**
 * - Tracks cumulative character length across array elements
 * - Handles extraction spanning single elements, adjacent elements, or multiple elements
 * - Filters out empty strings from the result
 * - Returns empty array when start position exceeds total text length
 *
 * @param text - A string or array of strings to extract from
 * @param start - Starting character position (inclusive, default: 0)
 * @param end - Ending character position (exclusive, default: end of input)
 * @returns Substring for string input, or array of string segments for array input
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
      // Calculate offset within the element where extraction should begin
      startOffset = row.length - (currentLength - (start ?? 0))
    }
    // Mark the first array element that exceeds the end position
    if (currentLength > (end ?? Infinity)) {
      endIndex = index
      // Calculate offset within the element where extraction should end
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
 * Memory-efficient generator that yields text chunks one at a time with consistent type preservation.
 *
 * Processes input text(s) and generates chunks based on the specified strategy (character-based
 * or paragraph-based). Maintains input type consistency by returning string chunks for string
 * input and single-element array chunks for array input. Tracks global character positions
 * across multiple text segments when processing arrays.
 *
 * **Processing Strategies:**
 * - `chunkStrategy: 'paragraph'`: Uses paragraph-based chunking with automatic sub-chunking
 * - Default: Uses character-based chunking with binary search optimization
 *
 * **Type Preservation:**
 * - String input → yields chunks with `text` as string
 * - Array input → yields chunks with `text` as single-element string array
 *
 * **Position Tracking:**
 * - Maintains global character offset across array elements
 * - Each chunk includes absolute start/end positions in the combined text
 * - Handles empty text segments by yielding empty chunks at correct positions
 *
 * @param text - A string or array of strings to split into chunks
 * @param options - Configuration options for chunking behavior
 * @yields Chunk objects with text content and character position metadata
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

      // Apply paragraph-based chunking with automatic sub-chunking
      const chunks: ChunkResult[] = chunkByParagraph(
        currentText,
        chunkUnits,
        chunkSize,
        chunkOverlap,
        splitter
      )
      for (const chunk of chunks)
        yield {
          // Maintain input type consistency (string vs array)
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
          // Maintain input type consistency (string vs array)
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
 * Splits text or array of texts into optimized chunks for LLM processing and vectorization.
 *
 * Primary entry point for text chunking that converts the generator output into a concrete array.
 * Supports both character-based and paragraph-based chunking strategies with configurable
 * token-based size limits and overlap. Designed specifically for LLM workflows where consistent
 * chunk sizes and semantic boundaries are important.
 *
 * **Default Behavior:**
 * - Uses character-based chunking with binary search optimization
 * - 512 token chunks with no overlap
 * - Character-based token splitting (1 char = 1 token)
 *
 * **Paragraph Strategy Benefits:**
 * - Preserves semantic paragraph boundaries when possible
 * - Automatic sub-chunking of oversized paragraphs
 * - Position-accurate overlap for chunk retrieval consistency
 *
 * **Input Type Handling:**
 * - String input: Returns chunks with text as strings
 * - Array input: Returns chunks with text as single-element arrays
 * - Maintains absolute character positions across all input types
 *
 * @param text - A string or array of strings to split into chunks
 * @param options - Configuration options for chunking behavior
 * @returns Array of chunk objects with text content and character position metadata
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): ChunkResult[] {
  return [...iterateChunks(text, options)]
}

export { split as default }
