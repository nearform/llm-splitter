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

    // Use generators to process chunks lazily without accumulating all chunks upfront
    const chunkGenerator =
      chunkStrategy === 'paragraph'
        ? chunkByParagraph(
            text,
            getUnits(text),
            chunkSize,
            chunkOverlap,
            splitter
          )
        : chunkByCharacter(text, chunkSize, splitter, chunkOverlap, 0)

    // Apply trimming to each chunk and adjust positions
    for (const chunk of chunkGenerator) {
      const chunkText = chunk.text as string
      const trimmed = chunkText.trim()
      const startAdjustment = chunkText.length - chunkText.trimStart().length
      const endAdjustment = chunkText.length - chunkText.trimEnd().length

      yield {
        text: trimmed,
        start: chunk.start + startAdjustment,
        end: chunk.end - endAdjustment
      }
    }
    return
  }

  // Array input: aggregate elements to maximize chunk utilization
  const texts: string[] = text
  if (texts.length === 0) return

  // Optimize by performing a single tokenization of the entire concatenated text
  const concatenatedText = texts.join('')
  const allTokens: string[] = splitter(concatenatedText)

  // Create a mapping from character positions to token indices
  const charToTokenMap: number[] = new Array(concatenatedText.length + 1)
  let charPos: number = 0

  for (let i = 0; i < allTokens.length; i++) {
    const tokenLength: number = allTokens[i].length
    for (let j = 0; j < tokenLength; j++) {
      charToTokenMap[charPos + j] = i
    }
    charPos += tokenLength
  }
  // Fill remaining positions with the last token index + 1
  for (let i = charPos; i <= concatenatedText.length; i++) {
    charToTokenMap[i] = allTokens.length
  }

  // Pre-compute element boundaries and token counts
  const elementBoundaries: Array<{
    start: number
    end: number
    tokenCount: number
  }> = []
  let globalOffset: number = 0

  for (const currentText of texts) {
    if (currentText.length === 0) continue // Skip empty elements

    const start = globalOffset
    const end = globalOffset + currentText.length
    const startToken = charToTokenMap[start]
    const endToken = charToTokenMap[end]
    const tokenCount = endToken - startToken

    elementBoundaries.push({ start, end, tokenCount })
    globalOffset += currentText.length
  }

  let aggregatedElements: string[] = []
  let aggregatedTokenCount: number = 0
  let chunkStartOffset: number = 0
  let previousChunkText: string[] = []
  let previousChunkEnd: number = 0

  const yieldChunk = (text: string[], start: number, end: number) => {
    // Handle empty input
    if (text.length === 0) {
      return null
    }

    // Trim leading empty strings and whitespace from first element
    let trimmedText = [...text]
    let startAdjustment = 0

    // Remove leading empty strings
    while (trimmedText.length > 0 && trimmedText[0] === '') trimmedText.shift()

    // Trim leading whitespace from first non-empty element
    if (trimmedText.length > 0) {
      const firstElement = trimmedText[0]
      const trimmedFirst = firstElement.trimStart()
      startAdjustment = firstElement.length - trimmedFirst.length
      trimmedText[0] = trimmedFirst
    }

    // Trim trailing empty strings and whitespace from last element
    let endAdjustment = 0

    // Remove trailing empty strings
    while (trimmedText.length > 0 && trimmedText[trimmedText.length - 1] === '')
      trimmedText.pop()

    // Trim trailing whitespace from last non-empty element
    if (trimmedText.length > 0) {
      const lastElement = trimmedText[trimmedText.length - 1]
      const trimmedLast = lastElement.trimEnd()
      endAdjustment = lastElement.length - trimmedLast.length
      trimmedText[trimmedText.length - 1] = trimmedLast
    }

    // If all elements were empty/whitespace, return null
    if (trimmedText.length === 0 || trimmedText.every(elem => elem === '')) {
      return null
    }

    return {
      text: trimmedText,
      start: start + startAdjustment,
      end: end - endAdjustment
    }
  }

  for (
    let elementIndex = 0;
    elementIndex < elementBoundaries.length;
    elementIndex++
  ) {
    const { start, end, tokenCount } = elementBoundaries[elementIndex]
    const currentText = concatenatedText.slice(start, end)

    // If adding this element would exceed chunk size and we have content, yield current chunk
    if (
      aggregatedTokenCount > 0 &&
      aggregatedTokenCount + tokenCount > chunkSize
    ) {
      const chunk = yieldChunk(aggregatedElements, chunkStartOffset, start)
      if (chunk !== null) yield chunk

      // Store for overlap calculation
      previousChunkText = [...aggregatedElements]
      previousChunkEnd = start

      // Calculate overlap for next chunk if needed
      if (chunkOverlap > 0 && previousChunkText.length > 0) {
        // For array aggregation with overlap, we include some elements from previous chunk
        const overlapElements: string[] = []
        let overlapTokenCount: number = 0

        // Add elements from the end of previous chunk until we reach overlap limit
        for (let j = previousChunkText.length - 1; j >= 0; j--) {
          // Use pre-computed token mapping instead of calling splitter
          const elementText = previousChunkText[j]
          const elementStartInPrev =
            previousChunkEnd - previousChunkText.slice(j).join('').length
          const elementEndInPrev = elementStartInPrev + elementText.length
          const elementStartToken = charToTokenMap[elementStartInPrev]
          const elementEndToken = charToTokenMap[elementEndInPrev]
          const elementTokens = elementEndToken - elementStartToken

          if (overlapTokenCount + elementTokens <= chunkOverlap) {
            overlapElements.unshift(previousChunkText[j])
            overlapTokenCount += elementTokens
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
        chunkStartOffset = start
      }
    }

    // If current element alone exceeds chunk size, need to split it
    if (tokenCount > chunkSize) {
      // First yield any accumulated content
      if (aggregatedElements.length > 0) {
        const chunk = yieldChunk(aggregatedElements, chunkStartOffset, start)
        if (chunk !== null) yield chunk
        previousChunkText = [...aggregatedElements]
        previousChunkEnd = start
        aggregatedElements = []
        aggregatedTokenCount = 0
        chunkStartOffset = start
      }

      // Split the oversized element using pre-computed token mapping instead of calling splitter again
      if (chunkStrategy === 'paragraph') {
        // For paragraph strategy, we still need to call the utilities but minimize splitter calls
        // Create a memoized splitter that reuses our computed tokens for the current element
        const elementStartToken = charToTokenMap[start]
        const elementTokens = allTokens.slice(
          elementStartToken,
          elementStartToken + tokenCount
        )

        const memoizedSplitter = (text: string) => {
          // If this is exactly our current element, return our pre-computed tokens
          if (text === currentText) {
            return elementTokens
          }
          // For sub-segments (paragraphs within the element), fall back to original splitter
          return splitter(text)
        }

        const chunkUnits: ChunkUnit[] = getUnits(currentText)
        const chunks: ChunkResult[] = chunkByParagraph(
          currentText,
          chunkUnits,
          chunkSize,
          chunkOverlap,
          memoizedSplitter
        )
        for (const chunk of chunks) {
          const chunkText = chunk.text as string
          const trimmed = chunkText.trim()
          if (trimmed.length === 0) continue // Skip empty chunks
          const startAdjustment =
            chunkText.length - chunkText.trimStart().length
          const endAdjustment = chunkText.length - chunkText.trimEnd().length
          yield {
            text: [trimmed],
            start: start + chunk.start + startAdjustment,
            end: start + chunk.end - endAdjustment
          }
        }
      } else {
        // For character-based splitting, implement inline to avoid additional splitter calls
        const elementStartToken = charToTokenMap[start]
        let currentTokenStart = elementStartToken

        while (currentTokenStart < elementStartToken + tokenCount) {
          let chunkTokenStart = currentTokenStart

          // Handle overlap if this isn't the first sub-chunk
          if (chunkOverlap > 0 && currentTokenStart > elementStartToken) {
            chunkTokenStart = Math.max(
              currentTokenStart - chunkOverlap,
              elementStartToken
            )
          }

          // Determine chunk end in token space
          const chunkTokenEnd = Math.min(
            chunkTokenStart + chunkSize,
            elementStartToken + tokenCount
          )

          // Convert token indices to character positions within the element
          let chunkStartChar = 0
          let chunkEndChar = currentText.length

          if (chunkTokenStart > elementStartToken) {
            for (let i = elementStartToken; i < chunkTokenStart; i++) {
              chunkStartChar += allTokens[i].length
            }
          }

          if (chunkTokenEnd < elementStartToken + tokenCount) {
            chunkEndChar = 0
            for (let i = elementStartToken; i < chunkTokenEnd; i++) {
              chunkEndChar += allTokens[i].length
            }
          }

          // Create sub-chunk
          const subChunkText = currentText.slice(chunkStartChar, chunkEndChar)
          const trimmed = subChunkText.trim()
          if (trimmed.length > 0) {
            const startAdjustment =
              subChunkText.length - subChunkText.trimStart().length
            const endAdjustment =
              subChunkText.length - subChunkText.trimEnd().length

            yield {
              text: [trimmed],
              start: start + chunkStartChar + startAdjustment,
              end: start + chunkEndChar - endAdjustment
            }
          }

          // Advance to next chunk position
          if (chunkOverlap >= chunkSize) {
            currentTokenStart = Math.max(chunkTokenEnd, currentTokenStart + 1)
          } else {
            currentTokenStart = chunkTokenEnd
          }

          if (chunkTokenEnd >= elementStartToken + tokenCount) break
        }
      }

      // Reset chunk start for next aggregation
      chunkStartOffset = end
      previousChunkText = []
      previousChunkEnd = end
    } else {
      // Add current element to aggregation
      if (aggregatedElements.length === 0 && chunkOverlap === 0)
        chunkStartOffset = start
      aggregatedElements.push(currentText)
      aggregatedTokenCount += tokenCount
    }
  }

  // Yield any remaining aggregated content
  if (aggregatedElements.length > 0) {
    const finalOffset =
      elementBoundaries.length > 0
        ? elementBoundaries[elementBoundaries.length - 1].end
        : 0
    const chunk = yieldChunk(aggregatedElements, chunkStartOffset, finalOffset)
    if (chunk !== null) yield chunk
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
