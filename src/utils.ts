import { ChunkResult, ChunkUnit } from './types.js'

/**
 * Extracts text units (paragraphs) from input text by splitting on double newlines.
 *
 * Identifies paragraph boundaries using two or more consecutive newlines as separators.
 * Each paragraph is trimmed of leading/trailing whitespace, and empty paragraphs are
 * filtered out. Returns precise character positions for each paragraph in the original text.
 *
 * @param text - The input text to split into paragraph units
 * @returns An array of paragraph units with their character positions in the original text
 */
export function getUnits(text: string): ChunkUnit[] {
  const units: ChunkUnit[] = []
  const regex: RegExp = /\n{2,}/g
  let lastIndex: number = 0
  let match: RegExpExecArray | null

  // Search for paragraph boundaries marked by double newlines
  while ((match = regex.exec(text)) !== null) {
    const end: number = match.index
    const rawUnit: string = text.slice(lastIndex, end)

    // Calculate trimmed boundaries without using indexOf
    const trimmedBounds: ChunkUnit | null = getTrimmedBounds(rawUnit)

    if (trimmedBounds) {
      const { unit, start, end } = trimmedBounds
      units.push({
        unit,
        start: lastIndex + start,
        end: lastIndex + end
      })
    }

    // Move past the current separator for next iteration
    lastIndex = regex.lastIndex
  }

  // Handle the final paragraph after the last separator
  const rawLastUnit: string = text.slice(lastIndex)
  const trimmedBounds: ChunkUnit | null = getTrimmedBounds(rawLastUnit)

  if (trimmedBounds) {
    const { unit, start, end } = trimmedBounds
    units.push({
      unit,
      start: lastIndex + start,
      end: lastIndex + end
    })
  }

  return units
}

/**
 * Calculates trimmed text boundaries efficiently without using indexOf.
 *
 * @param text - Raw text segment to trim and calculate bounds for
 * @returns Object with trimmed text and position offsets, or null if empty after trimming
 */
export function getTrimmedBounds(text: string): ChunkUnit | null {
  const len = text.length
  let start = 0
  let end = len

  // Find start of non-whitespace content
  while (start < len && /\s/.test(text[start])) {
    start++
  }

  // Find end of non-whitespace content
  while (end > start && /\s/.test(text[end - 1])) {
    end--
  }

  // Return null if no content after trimming
  if (start === end) {
    return null
  }

  return {
    unit: text.slice(start, end),
    start,
    end
  }
}

/**
 * Chunks text using a sliding window approach with token-based size calculation.
 *
 * Uses binary search to find optimal chunk boundaries that respect token limits while
 * maximizing chunk size. The algorithm ensures forward progress by guaranteeing at least
 * one character per chunk. Supports token-based overlap between consecutive chunks.
 *
 * **Key Features:**
 * - Binary search for optimal chunk boundaries within token limits
 * - Character-level overlap calculation (not position-accurate for token retrieval)
 * - Guaranteed forward progress to prevent infinite loops
 * - Absolute character position tracking with configurable start offset
 *
 * @param currentText - The text to chunk
 * @param chunkSize - Maximum size of each chunk in tokens
 * @param splitter - Function to split text into tokens for size calculation
 * @param chunkOverlap - Number of characters to overlap between chunks (approximate)
 * @param startOffset - Starting character position offset for calculating absolute positions
 * @returns Array of chunk objects with text and character positions
 */
export function chunkByCharacter(
  currentText: string,
  chunkSize: number,
  splitter: (text: string) => string[],
  chunkOverlap: number,
  startOffset: number = 0
): ChunkResult[] {
  let start: number = 0
  const textLen: number = currentText.length
  const chunks: ChunkResult[] = []
  while (start < textLen) {
    // Use binary search to find the optimal chunk boundary within token limits
    let low: number = start + 1
    let high: number = textLen
    let bestEnd: number = start + 1
    while (low <= high) {
      const mid: number = Math.floor((low + high) / 2)
      const len: number = splitter(currentText.slice(start, mid)).length
      if (len <= chunkSize) {
        bestEnd = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    // Guarantee forward progress by ensuring at least one character per chunk
    if (bestEnd === start) bestEnd = Math.min(start + 1, textLen)
    chunks.push({
      text: currentText.slice(start, bestEnd),
      start: startOffset + start,
      end: startOffset + bestEnd
    })
    if (bestEnd >= textLen) break
    // Calculate next starting position considering overlap requirements
    if (chunkOverlap > 0 && bestEnd > start)
      start = Math.max(bestEnd - chunkOverlap, start + 1)
    else start = bestEnd
  }
  return chunks
}

/**
 * Chunks text by paragraphs using a greedy sliding window approach with position-accurate overlap.
 *
 * Attempts to fit as many complete paragraphs as possible within the token limit while
 * preserving paragraph boundaries. When a single paragraph exceeds the limit, it is
 * automatically broken into sub-chunks using the same position-accurate overlap strategy.
 *
 * **Position-Accurate Overlap:**
 * - Uses binary search to find exact character positions that yield the desired token count
 * - Maintains split/getChunk consistency by ensuring overlapped chunks can be retrieved exactly
 * - Calculates overlap boundaries using actual character positions in the original text
 * - Overlap may include leading whitespace to achieve precise token counts
 *
 * **Chunking Strategy:**
 * - Greedy expansion: includes as many complete paragraphs as possible per chunk
 * - Oversized paragraph handling: automatically sub-chunks large paragraphs
 * - Labeled loop control: uses `outerLoop` for efficient paragraph processing
 * - Token counting: includes overlap tokens in current chunk size calculations
 *
 * @param originalText - The original text to extract chunks from
 * @param chunkUnits - Array of paragraph units with their character positions
 * @param chunkSize - Maximum size of each chunk in tokens
 * @param chunkOverlap - Number of tokens to overlap between chunks
 * @param splitter - Function to split text into tokens for size calculation
 * @returns Array of chunk objects with text and character positions
 */
export function chunkByParagraph(
  originalText: string,
  chunkUnits: ChunkUnit[],
  chunkSize: number,
  chunkOverlap: number,
  splitter: (text: string) => string[]
): ChunkResult[] {
  let i: number = 0
  const n: number = chunkUnits.length
  const chunks: ChunkResult[] = []

  outerLoop: while (i < n) {
    let currentLen: number = 0
    let j: number = i
    let chunkStart: number = chunkUnits[i].start
    let overlapStart: number = chunkStart

    // Calculate overlap start position from previous chunk if needed
    if (chunkOverlap > 0 && chunks.length > 0) {
      const prevChunk: ChunkResult = chunks[chunks.length - 1]
      overlapStart = calculateOverlapStart(
        originalText,
        prevChunk,
        chunkOverlap,
        splitter
      )

      // Count overlap tokens toward current chunk size
      const overlapText: string = originalText.slice(
        overlapStart,
        prevChunk.end
      )
      const overlapTokenCount: number = splitter(overlapText).length
      currentLen = overlapTokenCount
    }

    // Expand window to include as many complete paragraphs as possible
    while (j < n) {
      const unitLen: number = splitter(chunkUnits[j].unit).length
      const simulatedLen: number = currentLen + unitLen

      // Stop expanding if adding this paragraph would exceed the limit
      if (simulatedLen > chunkSize && j > i) break

      // Handle oversized single paragraph by breaking it into sub-chunks
      if (simulatedLen > chunkSize && j === i) {
        // For single large paragraph, create sub-chunks with position-accurate overlap
        const subChunks: ChunkResult[] = chunkSingleParagraphWithOverlap(
          originalText,
          chunkUnits[i],
          splitter,
          chunkSize,
          chunkOverlap,
          overlapStart
        )

        chunks.push(...subChunks)
        // Move to next paragraph after processing sub-chunks
        i++
        continue outerLoop
      }
      // Accept this paragraph and continue expanding
      currentLen = simulatedLen
      j++
    }

    // Create chunk from the selected paragraph range
    if (j > i) {
      const chunkEnd: number = chunkUnits[j - 1].end

      // Use overlap start only if we actually have overlap, otherwise use natural chunk start
      const finalChunkStart: number =
        chunkOverlap > 0 && chunks.length > 0 ? overlapStart : chunkStart

      // Extract text directly from original positions to ensure consistency
      const finalChunkText: string = originalText.slice(
        finalChunkStart,
        chunkEnd
      )

      chunks.push({
        text: finalChunkText,
        start: finalChunkStart,
        end: chunkEnd
      })
    }

    // Move to next set of paragraphs
    i = j
  }

  return chunks
}

/**
 * Calculates the exact character position where overlap should start based on token count.
 *
 * Uses binary search to find the precise character position in the original text that
 * corresponds to the desired number of overlap tokens from the end of the previous chunk.
 * This ensures position-accurate overlap that maintains split/getChunk consistency.
 *
 * **Binary Search Algorithm:**
 * - Searches within the previous chunk's character range
 * - Tests character positions to find exact token count matches
 * - Handles cases where requested overlap exceeds available tokens
 * - Returns the leftmost position that yields the target token count
 *
 * **Edge Cases:**
 * - If no overlap requested (chunkOverlap = 0), returns previous chunk's end position
 * - If requested overlap exceeds available tokens, uses all available tokens
 * - May include leading whitespace to achieve precise token counts
 *
 * @param originalText - The original text to extract overlap from
 * @param prevChunk - The previous chunk to calculate overlap from
 * @param chunkOverlap - Number of tokens to overlap
 * @param splitter - Function to split text into tokens for counting
 * @returns Character position where overlap should start in the original text
 */
export function calculateOverlapStart(
  originalText: string,
  prevChunk: ChunkResult,
  chunkOverlap: number,
  splitter: (text: string) => string[]
): number {
  const prevText: string = originalText.slice(prevChunk.start, prevChunk.end)
  const prevTokens: string[] = splitter(prevText)

  // If requested overlap is greater than available tokens, use all available
  const actualOverlap: number = Math.min(chunkOverlap, prevTokens.length)

  if (actualOverlap === 0) {
    return prevChunk.end
  }

  // Use binary search to find the character position that gives us exactly the right number of tokens
  let low: number = prevChunk.start
  let high: number = prevChunk.end
  let bestStart: number = prevChunk.end

  while (low <= high) {
    const mid: number = Math.floor((low + high) / 2)
    const testText: string = originalText.slice(mid, prevChunk.end)
    const testTokens: string[] = splitter(testText)

    if (testTokens.length <= actualOverlap) {
      bestStart = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return bestStart
}

/**
 * Breaks a single paragraph that exceeds the chunk size limit into smaller sub-chunks
 * with position-accurate overlap that maintains split/getChunk consistency.
 *
 * This function is called when a single paragraph is too large to fit within the token
 * limit. It processes the paragraph token by token, creating sub-chunks that respect
 * the size limit while maintaining precise overlap positioning.
 *
 * **Sub-chunking Process:**
 * - Tokenizes the oversized paragraph and processes tokens sequentially
 * - First sub-chunk starts at the provided position (may include overlap from previous chunk)
 * - Subsequent sub-chunks use calculateOverlapStart for position-accurate overlap
 * - Ensures forward progress by including at least one token per sub-chunk
 *
 * **Position Calculation:**
 * - Maps token boundaries back to character positions in the original text
 * - Handles overlap by counting overlap tokens toward current sub-chunk size
 * - Maintains consistency between token processing and character positioning
 *
 * **Edge Case Handling:**
 * - Prevents infinite loops with zero-progress detection
 * - Respects paragraph boundaries (sub-chunks don't exceed original paragraph end)
 * - Handles empty tokens gracefully
 *
 * @param originalText - The original text to extract sub-chunks from
 * @param unit - The paragraph unit that needs to be sub-chunked
 * @param splitter - Function to split text into tokens for processing
 * @param chunkSize - Maximum size of each sub-chunk in tokens
 * @param chunkOverlap - Number of tokens to overlap between sub-chunks
 * @param firstChunkStart - Starting character position for the first sub-chunk (may include overlap from previous chunk)
 * @returns Array of sub-chunk objects with text and character positions
 */
function chunkSingleParagraphWithOverlap(
  originalText: string,
  unit: ChunkUnit,
  splitter: (text: string) => string[],
  chunkSize: number,
  chunkOverlap: number,
  firstChunkStart: number
): ChunkResult[] {
  const unitText: string = unit.unit
  const tokens: string[] = splitter(unitText)
  const chunks: ChunkResult[] = []
  let tokenIndex: number = 0

  while (tokenIndex < tokens.length) {
    let currentChunkSize: number = 0
    let chunkStart: number
    let overlapTokenCount: number = 0

    // Calculate overlap for subsequent chunks
    if (chunks.length > 0 && chunkOverlap > 0) {
      const prevChunk: ChunkResult = chunks[chunks.length - 1]
      chunkStart = calculateOverlapStart(
        originalText,
        prevChunk,
        chunkOverlap,
        splitter
      )

      // Count overlap tokens toward current chunk size
      const overlapText: string = originalText.slice(chunkStart, prevChunk.end)
      overlapTokenCount = splitter(overlapText).length
      currentChunkSize = overlapTokenCount
    } else {
      // First chunk uses the provided start position
      // For subsequent chunks with no overlap, calculate position from token progress
      if (chunks.length > 0) {
        // Calculate where this chunk should start based on tokens processed so far
        const tokensProcessed: string[] = tokens.slice(0, tokenIndex)
        const textProcessed: string = tokensProcessed.join('')
        chunkStart = unit.start + textProcessed.length
      } else {
        chunkStart = firstChunkStart
      }
    }

    // Find how many additional tokens we can include
    let endTokenIndex: number = tokenIndex
    while (endTokenIndex < tokens.length && currentChunkSize < chunkSize) {
      currentChunkSize++
      endTokenIndex++
    }

    // Ensure we make progress
    if (endTokenIndex === tokenIndex) {
      endTokenIndex = Math.min(tokenIndex + 1, tokens.length)
    }

    // Calculate end position by finding character position corresponding to token boundary
    const tokensForEnd: string[] = tokens.slice(0, endTokenIndex)
    const textForEnd: string = tokensForEnd.join('')
    const chunkEnd: number = Math.min(unit.start + textForEnd.length, unit.end)

    // Extract text from original positions
    const chunkText: string = originalText.slice(chunkStart, chunkEnd)

    chunks.push({
      text: chunkText,
      start: chunkStart,
      end: chunkEnd
    })

    tokenIndex = endTokenIndex

    // Prevent infinite loops
    if (currentChunkSize === 0) {
      tokenIndex++
    }
  }

  return chunks
}
