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
 * Memory-efficient generator that yields optimized text chunks with intelligent aggregation.
 *
 * Processes input text(s) and generates chunks based on the specified strategy. For array input,
 * aggregates multiple elements together until the token count reaches the chunkSize limit,
 * maximizing chunk utilization. For string input, uses standard chunking strategies.
 *
 * **Processing Strategies:**
 * - `chunkStrategy: 'paragraph'`: Uses paragraph-based chunking with automatic sub-chunking
 * - Default: Uses character-based chunking with binary search optimization
 *
 * **Aggregation Behavior (Array Input):**
 * - Combines multiple array elements into single chunks up to chunkSize token limit
 * - Maintains element boundaries within aggregated chunks
 * - Handles oversized elements by splitting them using the chosen strategy
 * - Skips empty elements entirely (zero-length strings are not included in chunks)
 *
 * **Type Preservation:**
 * - String input → yields chunks with `text` as string
 * - Array input → yields chunks with `text` as array of aggregated elements
 *
 * **Position Tracking:**
 * - Maintains global character offset across non-empty array elements only
 * - Each chunk includes absolute start/end positions spanning all aggregated elements
 * - Start position: beginning of first aggregated element
 * - End position: end of last aggregated element
 * - Empty elements do not contribute to position calculations
 *
 * @param text - A string or array of strings to split into chunks
 * @param options - Configuration options for chunking behavior
 * @yields Chunk objects with optimally aggregated text content and position metadata
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
  // For single string input, use existing chunking logic
  if (typeof text === 'string') {
    if (text.length === 0) {
      yield { text: '', start: 0, end: 0 }
      return
    }

    if (chunkStrategy === 'paragraph')
      yield* chunkByParagraph(
        text,
        getUnits(text),
        chunkSize,
        chunkOverlap,
        splitter
      )
    else yield* chunkByCharacter(text, chunkSize, splitter, chunkOverlap, 0)
    return
  }

  // Array input: aggregate elements to maximize chunk utilization
  const texts: string[] = text
  if (texts.length === 0) return

  let globalOffset: number = 0
  let aggregatedElements: string[] = []
  let aggregatedTokenCount: number = 0
  let chunkStartOffset: number = 0
  let previousChunkText: string[] = []
  let previousChunkEnd: number = 0

  const yieldChunk = (elements: string[], start: number, end: number) => {
    return {
      text: elements,
      start,
      end
    }
  }

  for (let i = 0; i < texts.length; i++) {
    const currentText = texts[i]

    // Skip empty text segments entirely - they don't contribute to chunks or positions
    if (currentText.length === 0) {
      continue
    }

    // Calculate token count for current text
    const currentTokens = splitter(currentText)
    const currentTokenCount = currentTokens.length

    // If adding this element would exceed chunk size and we have content, yield current chunk
    if (
      aggregatedTokenCount > 0 &&
      aggregatedTokenCount + currentTokenCount > chunkSize
    ) {
      yield yieldChunk(aggregatedElements, chunkStartOffset, globalOffset)

      // Store for overlap calculation
      previousChunkText = [...aggregatedElements]
      previousChunkEnd = globalOffset

      // Calculate overlap for next chunk if needed
      if (chunkOverlap > 0 && previousChunkText.length > 0) {
        // For array aggregation with overlap, we include some elements from previous chunk
        const overlapElements: string[] = []
        let overlapTokenCount = 0

        // Add elements from the end of previous chunk until we reach overlap limit
        for (let j = previousChunkText.length - 1; j >= 0; j--) {
          const elementTokens = splitter(previousChunkText[j])
          if (overlapTokenCount + elementTokens.length <= chunkOverlap) {
            overlapElements.unshift(previousChunkText[j])
            overlapTokenCount += elementTokens.length
          } else {
            break
          }
        }

        // Start new chunk with overlap elements
        aggregatedElements = [...overlapElements]
        aggregatedTokenCount = overlapTokenCount
        chunkStartOffset = previousChunkEnd - overlapElements.join('').length
      } else {
        // Reset aggregation state
        aggregatedElements = []
        aggregatedTokenCount = 0
        chunkStartOffset = globalOffset
      }
    }

    // If current element alone exceeds chunk size, need to split it
    if (currentTokenCount > chunkSize) {
      // First yield any accumulated content
      if (aggregatedElements.length > 0) {
        yield yieldChunk(aggregatedElements, chunkStartOffset, globalOffset)
        previousChunkText = [...aggregatedElements]
        previousChunkEnd = globalOffset
        aggregatedElements = []
        aggregatedTokenCount = 0
        chunkStartOffset = globalOffset
      }

      // Split the oversized element using character chunking
      if (chunkStrategy === 'paragraph') {
        const chunkUnits: ChunkUnit[] = getUnits(currentText)
        const chunks: ChunkResult[] = chunkByParagraph(
          currentText,
          chunkUnits,
          chunkSize,
          chunkOverlap,
          splitter
        )
        for (const chunk of chunks) {
          yield yieldChunk(
            [chunk.text as string],
            globalOffset + chunk.start,
            globalOffset + chunk.end
          )
        }
      } else {
        const chunks: ChunkResult[] = chunkByCharacter(
          currentText,
          chunkSize,
          splitter,
          chunkOverlap,
          globalOffset
        )
        for (const chunk of chunks) {
          yield yieldChunk([chunk.text as string], chunk.start, chunk.end)
        }
      }

      // Reset chunk start for next aggregation
      chunkStartOffset = globalOffset + currentText.length
      previousChunkText = []
      previousChunkEnd = globalOffset + currentText.length
    } else {
      // Add current element to aggregation
      if (aggregatedElements.length === 0 && chunkOverlap === 0) {
        chunkStartOffset = globalOffset
      }
      aggregatedElements.push(currentText)
      aggregatedTokenCount += currentTokenCount
    }

    globalOffset += currentText.length
  }

  // Yield any remaining aggregated content
  if (aggregatedElements.length > 0) {
    yield yieldChunk(aggregatedElements, chunkStartOffset, globalOffset)
  }
}

/**
 * Splits text or array of texts into optimized chunks for LLM processing and vectorization.
 *
 * Primary entry point for text chunking that converts the generator output into a concrete array.
 * Supports both character-based and paragraph-based chunking strategies with configurable
 * token-based size limits and overlap. For array input, intelligently aggregates multiple
 * elements into optimally-sized chunks to maximize utilization of the chunkSize limit.
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
 * - Array input: Returns chunks with text as arrays of aggregated elements
 * - Aggregation maximizes chunk size utilization up to token limit
 * - Maintains absolute character positions across all aggregated content
 * - Empty elements (zero-length strings) are completely skipped and do not appear in chunks
 *
 * @param text - A string or array of strings to split into chunks
 * @param options - Configuration options for chunking behavior
 * @returns Array of chunk objects with optimally aggregated content and position metadata
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): ChunkResult[] {
  return [...iterateChunks(text, options)]
}

export { split as default }
