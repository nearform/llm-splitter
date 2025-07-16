import type { SplitOptions, ChunkUnit, ChunkResult } from './types.js'
import { chunkByCharacter, chunkByParagraph, getUnits } from './utils.js'

/**
 * Extracts a specific text segment from input by character positions.
 *
 * This function provides precise text extraction that preserves the input type - string input
 * returns a string, array input returns an array. For array inputs, it handles complex scenarios
 * where the extraction range spans multiple array elements, calculating precise boundaries
 * and character offsets within each element.
 *
 * **String Input:**
 * - Returns a substring using standard slice() operation
 * - Simple and efficient for single text extraction
 *
 * **Array Input:**
 * - Tracks cumulative character positions across all array elements
 * - Handles extraction that spans partial, complete, or multiple elements
 * - Automatically filters out empty strings from results
 * - Returns empty array when start position exceeds total text length
 *
 * **Use Cases:**
 * - Retrieving specific chunks by position for validation
 * - Implementing consistent retrieval for chunked content
 * - Cross-referencing chunk boundaries with original text
 *
 * @param text - Source text (string) or array of text segments (string[])
 * @param start - Starting character position, inclusive (default: 0)
 * @param end - Ending character position, exclusive (default: end of text)
 * @returns Extracted text maintaining the same type as input
 *
 * @example
 * ```typescript
 * // String extraction
 * const text = "Hello world example"
 * const chunk = getChunk(text, 6, 11) // "world"
 *
 * // Array extraction spanning multiple elements
 * const texts = ["Hello ", "world ", "example"]
 * const chunk = getChunk(texts, 3, 12) // ["lo ", "world ", "ex"]
 * ```
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
 * Memory-efficient generator that produces optimized text chunks with intelligent aggregation.
 *
 * This is the core chunking engine that processes input text and generates chunks based on
 * the specified strategy. It supports both single strings and arrays of strings, with
 * sophisticated aggregation logic for arrays that maximizes chunk utilization while
 * respecting token limits and maintaining precise position tracking.
 *
 * **Processing Strategies:**
 * - `chunkStrategy: 'paragraph'`: Paragraph-aware chunking that respects document structure
 * - `chunkStrategy: 'character'` (default): Uses binary search optimization for efficient chunking
 *
 * **Array Aggregation Logic:**
 * - Combines multiple array elements into single chunks until token limit is reached
 * - Maintains element boundaries within aggregated chunks for traceability
 * - Handles oversized elements by automatically splitting them using the chosen strategy
 * - Skips empty elements entirely - they do not appear in any chunks
 *
 * **Empty Input Handling:**
 * - Empty string input: Returns immediately without yielding any chunks
 * - Empty array input: Returns immediately without yielding any chunks
 * - Zero-length elements in arrays: Completely skipped during processing
 *
 * **Type Preservation:**
 * - String input → Yields chunks with `text` as string
 * - Array input → Yields chunks with `text` as array of aggregated string elements
 *
 * **Position Tracking:**
 * - Maintains accurate global character offset across all non-empty elements
 * - Each chunk includes absolute start/end positions spanning all aggregated content
 * - Start position: Beginning of first aggregated element
 * - End position: End of last aggregated element
 * - Empty elements do not contribute to position calculations
 *
 * **Overlap Handling:**
 * - For strings: Uses optimized algorithms from utils (chunkByCharacter/chunkByParagraph)
 * - For arrays: Implements element-level overlap by including elements from previous chunks
 * - Precise token counting ensures overlap targets are met within specified tolerance
 *
 * @param text - Input text (string) or array of text segments (string[]) to chunk
 * @param options - Configuration options controlling chunking behavior
 * @param options.chunkSize - Maximum tokens per chunk (default: 512)
 * @param options.chunkOverlap - Number of tokens to overlap between chunks (default: 0)
 * @param options.splitter - Custom tokenization function (default: character-based)
 * @param options.chunkStrategy - Chunking strategy ('paragraph' or 'character', default: 'character')
 * @yields Chunk objects with optimally aggregated text content and precise position metadata
 *
 * @example
 * ```typescript
 * // Basic string chunking
 * for (const chunk of iterateChunks("Long text content...", { chunkSize: 100 })) {
 *   console.log(`Chunk: ${chunk.text.slice(0, 50)}...`)
 *   console.log(`Position: ${chunk.start}-${chunk.end}`)
 * }
 *
 * // Array aggregation with overlap
 * const documents = ["Doc 1 content", "Doc 2 content", "Doc 3 content"]
 * for (const chunk of iterateChunks(documents, {
 *   chunkSize: 50,
 *   chunkOverlap: 10
 * })) {
 *   console.log(`Aggregated elements: ${chunk.text.length}`)
 * }
 * ```
 */
export function* iterateChunks(
  text: string | string[],
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter = (text: string) => text.split(''),
    chunkStrategy = 'character'
  }: SplitOptions = {}
): Generator<ChunkResult> {
  // For single string input, use existing chunking logic
  if (typeof text === 'string') {
    if (text.length === 0) {
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

  const yieldChunk = (text: string[], start: number, end: number) => ({
    text,
    start,
    end
  })

  for (const currentText of texts) {
    // Skip empty text segments entirely - they don't contribute to chunks or positions
    if (currentText.length === 0) continue

    // Calculate token count for current text
    const currentTokens: string[] = splitter(currentText)
    const currentTokenCount: number = currentTokens.length

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
        let overlapTokenCount: number = 0

        // Add elements from the end of previous chunk until we reach overlap limit
        for (let j = previousChunkText.length - 1; j >= 0; j--) {
          const elementTokens: string[] = splitter(previousChunkText[j])
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

      // Split the oversized element using paragraph chunking
      if (chunkStrategy === 'paragraph') {
        const chunkUnits: ChunkUnit[] = getUnits(currentText)
        const chunks: ChunkResult[] = chunkByParagraph(
          currentText,
          chunkUnits,
          chunkSize,
          chunkOverlap,
          splitter
        )
        for (const chunk of chunks)
          yield yieldChunk(
            [chunk.text as string],
            globalOffset + chunk.start,
            globalOffset + chunk.end
          )
      } else {
        const chunks: ChunkResult[] = chunkByCharacter(
          currentText,
          chunkSize,
          splitter,
          chunkOverlap,
          globalOffset
        )
        for (const chunk of chunks)
          yield yieldChunk([chunk.text as string], chunk.start, chunk.end)
      }

      // Reset chunk start for next aggregation
      chunkStartOffset = globalOffset + currentText.length
      previousChunkText = []
      previousChunkEnd = globalOffset + currentText.length
    } else {
      // Add current element to aggregation
      if (aggregatedElements.length === 0 && chunkOverlap === 0)
        chunkStartOffset = globalOffset
      aggregatedElements.push(currentText)
      aggregatedTokenCount += currentTokenCount
    }

    globalOffset += currentText.length
  }

  // Yield any remaining aggregated content
  if (aggregatedElements.length > 0)
    yield yieldChunk(aggregatedElements, chunkStartOffset, globalOffset)
}

/**
 * Splits text or array of texts into optimized chunks for LLM processing and vectorization.
 *
 * Primary entry point for text chunking that converts the generator output into a concrete array.
 * Supports both character-based and paragraph-based chunking strategies with configurable
 * token-based size limits and overlap. For array input, intelligently aggregates multiple
 * elements into optimally-sized chunks to maximize utilization of the chunkSize limit.
 *
 * **Key Features:**
 * - Intelligent array aggregation for optimal chunk utilization
 * - Precise token-based overlap control with custom splitter support
 * - Paragraph-aware chunking that preserves semantic boundaries
 * - Automatic sub-chunking of oversized content
 * - Complete position tracking for all chunks
 * - Empty input handling (returns empty array for empty strings/arrays)
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
 * - String input: Returns chunks with text as strings, empty strings produce no chunks
 * - Array input: Returns chunks with text as arrays of aggregated elements
 * - Aggregation maximizes chunk size utilization up to token limit
 * - Maintains absolute character positions across all aggregated content
 * - Empty elements (zero-length strings) are completely skipped and do not appear in chunks
 *
 * @param text - A string or array of strings to split into chunks
 * @param options - Configuration options for chunking behavior
 * @param options.chunkSize - Maximum tokens per chunk (default: 512)
 * @param options.chunkOverlap - Number of tokens to overlap between chunks (default: 0)
 * @param options.splitter - Custom tokenization function (default: character-based)
 * @param options.chunkStrategy - Chunking strategy ('paragraph' or 'character', default: 'character')
 * @returns Array of chunk objects with optimally aggregated content and position metadata
 *
 * @example
 * ```typescript
 * import { split } from '@nearform/llm-chunk'
 *
 * // Basic usage with default settings
 * const chunks = split("Your long text content here...")
 *
 * // Paragraph-aware chunking with custom size and overlap
 * const paragraphChunks = split(document, {
 *   chunkSize: 200,
 *   chunkOverlap: 20,
 *   chunkStrategy: 'paragraph'
 * })
 *
 * // Array aggregation
 * const documents = ["Doc 1", "Doc 2", "Doc 3"]
 * const aggregatedChunks = split(documents, { chunkSize: 100 })
 *
 * // Custom tokenization with tiktoken
 * import { get_encoding } from 'tiktoken'
 * const encoding = get_encoding('gpt2')
 * const chunks = split(text, {
 *   chunkSize: 100,
 *   splitter: (text) => encoding.encode(text).map(t => encoding.decode([t]))
 * })
 * ```
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): ChunkResult[] {
  return [...iterateChunks(text, options)]
}

export { split as default }
