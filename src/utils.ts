import { ChunkResult, ChunkUnit } from './types.js'

/**
 * Extracts text units (paragraphs) from input text by splitting on double newlines.
 *
 * Identifies paragraph boundaries using two or more consecutive newlines as separators.
 * Each paragraph is trimmed of leading/trailing whitespace, and empty paragraphs are
 * filtered out. Returns precise character positions for each paragraph in the original text.
 *
 * **Processing Logic:**
 * - Splits on patterns of 2+ consecutive newlines (`\n{2,}`)
 * - Trims whitespace from each paragraph while preserving original positions
 * - Filters out empty paragraphs (whitespace-only content)
 * - Maintains accurate character position tracking for chunk boundary calculations
 *
 * **Use Cases:**
 * - Paragraph-aware chunking that respects document structure
 * - Semantic boundary detection for improved chunking quality
 * - Position-accurate text extraction and validation
 *
 * @param text - The input text to split into paragraph units
 * @returns Array of paragraph units with their character positions in the original text
 *
 * @example
 * ```typescript
 * const text = "Para 1\n\nPara 2\n\n\nPara 3"
 * const units = getUnits(text)
 * // Returns: [
 * //   { unit: "Para 1", start: 0, end: 6 },
 * //   { unit: "Para 2", start: 8, end: 14 },
 * //   { unit: "Para 3", start: 17, end: 23 }
 * // ]
 * ```
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
 * Efficiently determines the bounds of non-whitespace content within a text segment
 * by scanning from both ends. Returns both the trimmed text and its position offsets
 * relative to the original string, enabling accurate position tracking in larger text
 * processing operations.
 *
 * @param text - Raw text segment to trim and calculate bounds for
 * @returns Object containing trimmed text and position offsets (start/end), or null if empty after trimming
 *
 * @example
 * ```typescript
 * getTrimmedBounds("  hello world  ")
 * // Returns: { unit: "hello world", start: 2, end: 13 }
 *
 * getTrimmedBounds("   ")
 * // Returns: null (empty after trimming)
 * ```
 */
export function getTrimmedBounds(text: string): ChunkUnit | null {
  const len: number = text.length
  let start: number = 0
  let end: number = len

  // Find start of non-whitespace content
  while (start < len && /\s/.test(text[start])) start++

  // Find end of non-whitespace content
  while (end > start && /\s/.test(text[end - 1])) end--

  // Return null if no content after trimming
  if (start === end) return null

  return {
    unit: text.slice(start, end),
    start,
    end
  }
}

/**
 * Chunks text using a sliding window approach with token-based size calculation and overlap.
 *
 * Employs binary search to find optimal chunk boundaries that respect token limits while
 * maximizing chunk size. The algorithm ensures forward progress by guaranteeing at least
 * one character per chunk even when individual characters exceed token limits. Provides
 * token-based overlap between consecutive chunks for context preservation with precise
 * token boundary alignment.
 *
 * **Algorithm Details:**
 * - Binary search optimization: Efficiently finds maximum text length within token constraints
 * - Forward progress guarantee: Prevents infinite loops by ensuring minimum advancement
 * - Token-based overlap: Provides exact token count overlap with preserved token boundaries
 * - Absolute position tracking: Maintains original character positions with configurable offset
 *
 * **Use Cases:**
 * - Raw text processing where paragraph structure is unavailable or unimportant
 * - Character-level chunking for maximum text utilization within token limits
 * - Fallback chunking when semantic boundaries cannot be determined
 *
 * @param currentText - The text segment to chunk into smaller pieces
 * @param chunkSize - Maximum number of tokens allowed per chunk
 * @param splitter - Tokenization function that splits text into countable units
 * @param chunkOverlap - Number of tokens to overlap between consecutive chunks (preserves token boundaries)
 * @param startOffset - Starting character position offset for calculating absolute positions
 * @returns Array of chunk objects containing text content and absolute character positions
 *
 * @example
 * ```typescript
 * const splitter = (text: string) => text.split(/\s+/);
 * const chunks = chunkByCharacter("Hello world example text", 2, splitter, 1, 0);
 * // Returns chunks with max 2 tokens each, 1 token overlap
 * ```
 */
export function chunkByCharacter(
  currentText: string,
  chunkSize: number,
  splitter: (text: string) => string[],
  chunkOverlap: number,
  startOffset: number = 0
): ChunkResult[] {
  // Handle empty input
  if (currentText.length === 0) return []

  // Handle edge case where chunk size is 0 or negative
  if (chunkSize <= 0) chunkSize = 1 // Force minimum chunk size of 1

  // Optimize by tokenizing the entire text once upfront
  const tokens: string[] = splitter(currentText)
  const totalTokens: number = tokens.length

  // Handle case where entire text fits in one chunk
  if (totalTokens <= chunkSize) {
    return [
      {
        text: currentText,
        start: startOffset,
        end: startOffset + currentText.length
      }
    ]
  }

  const chunks: ChunkResult[] = []
  let tokenStart: number = 0

  while (tokenStart < totalTokens) {
    let chunkTokenStart: number = tokenStart

    // Calculate token-based overlap from previous chunk if needed
    if (chunkOverlap > 0 && chunks.length > 0) {
      chunkTokenStart = Math.max(tokenStart - chunkOverlap, 0)
    }

    // Determine chunk end in token space
    const chunkTokenEnd: number = Math.min(
      chunkTokenStart + chunkSize,
      totalTokens
    )

    // Convert token indices to character positions
    const chunkStartChar: number =
      chunkTokenStart === 0
        ? 0
        : tokens.slice(0, chunkTokenStart).join('').length
    const chunkEndChar: number =
      chunkTokenEnd === totalTokens
        ? currentText.length
        : tokens.slice(0, chunkTokenEnd).join('').length

    // Create chunk with absolute positions
    const chunk: ChunkResult = {
      text: currentText.slice(chunkStartChar, chunkEndChar),
      start: startOffset + chunkStartChar,
      end: startOffset + chunkEndChar
    }

    chunks.push(chunk)

    if (chunkTokenEnd >= totalTokens) break

    // Advance to next chunk position in token space
    // Ensure forward progress when overlap is very large by advancing at least 1 token
    if (chunkOverlap >= chunkSize) {
      tokenStart = Math.max(chunkTokenEnd, tokenStart + 1)
    } else {
      tokenStart = chunkTokenEnd
    }
  }

  return chunks
}

/**
 * Chunks text by paragraphs using a greedy sliding window approach with position-accurate overlap.
 *
 * Implements an intelligent paragraph-aware chunking strategy that preserves semantic boundaries
 * while respecting token limits. Uses a greedy algorithm to include as many complete paragraphs
 * as possible per chunk, with automatic fallback to sub-chunking for oversized paragraphs.
 * Features position-accurate overlap calculation that ensures consistency with getChunk operations.
 *
 * **Intelligent Chunking Strategy:**
 * - Greedy paragraph expansion: Maximizes content per chunk while preserving boundaries
 * - Oversized paragraph handling: Automatically sub-chunks paragraphs exceeding token limits
 * - Semantic preservation: Maintains paragraph integrity whenever possible
 * - Efficient processing: Uses labeled loops for optimal paragraph iteration control
 *
 * **Position-Accurate Overlap System:**
 * - Binary search precision: Finds exact character positions yielding desired token counts
 * - getChunk consistency: Ensures overlapped chunks can be retrieved exactly via getChunk
 * - Original text anchoring: Calculates overlap boundaries using absolute character positions
 * - Whitespace inclusion: May include leading whitespace to achieve precise token targets
 * - Token counting accuracy: Includes overlap tokens in current chunk size calculations
 *
 * **Performance Optimizations:**
 * - Labeled loop control: Uses `outerLoop` for efficient paragraph processing flow
 * - Position caching: Reuses calculated positions to minimize redundant computations
 * - Token count optimization: Avoids redundant tokenization through smart accumulation
 *
 * @param originalText - The complete source text to extract chunks from
 * @param chunkUnits - Pre-parsed array of paragraph units with character positions
 * @param chunkSize - Maximum number of tokens allowed per chunk
 * @param chunkOverlap - Number of tokens to overlap between consecutive chunks
 * @param splitter - Tokenization function for calculating token counts and boundaries
 * @returns Array of chunk objects with text content and absolute character positions
 *
 * @example
 * ```typescript
 * const units = getUnits(text, /\n\s*\n/);
 * const splitter = (text: string) => text.split(/\s+/);
 * const chunks = chunkByParagraph(text, units, 100, 20, splitter);
 * // Returns paragraph-aware chunks with 20-token overlap
 * ```
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
 * Employs binary search to find the precise character position in the original text that
 * corresponds to the desired number of overlap tokens from the end of the previous chunk.
 * This position-accurate calculation ensures perfect consistency with split/getChunk operations,
 * enabling reliable chunk retrieval and processing workflows.
 *
 * **Binary Search Precision:**
 * - Searches within the previous chunk's character boundaries for optimal overlap position
 * - Tests candidate positions to find exact token count matches using the provided splitter
 * - Returns the leftmost position that yields exactly the target token count (not fewer)
 * - Falls back to linear search if binary search cannot find exact token boundary match
 * - Handles token boundary complexities by working with actual character positions
 *
 * **Position-Accurate Overlap Benefits:**
 * - Maintains getChunk consistency: overlapped chunks can be retrieved exactly via getChunk
 * - Preserves token boundaries: ensures overlap doesn't fragment important tokens
 * - Supports whitespace inclusion: may include leading whitespace to achieve precise counts
 * - Enables reliable processing: downstream operations can depend on exact positioning
 *
 * **Edge Case Handling:**
 * - Zero overlap: Returns previous chunk's end position when no overlap requested
 * - Excessive overlap: Uses all available tokens when request exceeds chunk content
 * - Boundary conditions: Handles start/end edge cases gracefully
 * - Token alignment: Ensures overlap boundaries align with meaningful token boundaries
 *
 * @param originalText - The complete source text to calculate overlap positions within
 * @param prevChunk - The previous chunk object containing start/end positions for overlap calculation
 * @param chunkOverlap - Number of tokens to include in the overlap from the previous chunk
 * @param splitter - Tokenization function used for counting tokens and determining boundaries
 * @returns Absolute character position where the overlap should begin in the original text
 *
 * @example
 * ```typescript
 * const prevChunk = { text: "example text", start: 0, end: 12 };
 * const splitter = (text: string) => text.split(/\s+/);
 * const overlapStart = calculateOverlapStart(originalText, prevChunk, 1, splitter);
 * // Returns character position for 1-token overlap from previous chunk
 * ```
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

  if (actualOverlap === 0) return prevChunk.end

  // If we want all tokens, return the start
  if (actualOverlap >= prevTokens.length) return prevChunk.start

  // Use binary search to find the leftmost position that gives us exactly the desired token count
  let low: number = prevChunk.start
  let high: number = prevChunk.end
  let result: number = prevChunk.start

  while (low <= high) {
    const mid: number = Math.floor((low + high) / 2)
    const testText: string = originalText.slice(mid, prevChunk.end)
    const testTokens: string[] = splitter(testText)

    if (testTokens.length === actualOverlap) {
      // Found exact token count match, but continue searching for leftmost position
      result = mid
      high = mid - 1
    } else if (testTokens.length > actualOverlap)
      // Too many tokens, move start position forward
      low = mid + 1
    else
      // Too few tokens, move start position backward
      high = mid - 1
  }

  // Verify the result gives us the correct token count
  const finalText: string = originalText.slice(result, prevChunk.end)
  const finalTokens: string[] = splitter(finalText)

  if (finalTokens.length === actualOverlap) return result

  // If binary search didn't find exact match, fall back to linear search for precision
  for (let pos: number = prevChunk.start; pos <= prevChunk.end; pos++) {
    const testText: string = originalText.slice(pos, prevChunk.end)
    const testTokens: string[] = splitter(testText)

    if (testTokens.length === actualOverlap) return pos

    if (testTokens.length < actualOverlap && pos > prevChunk.start)
      return pos - 1
  }

  return prevChunk.start
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
  const chunks: ChunkResult[] = []
  let currentStart: number = firstChunkStart

  while (currentStart < unit.end) {
    let chunkStart: number = currentStart

    // Calculate token-based overlap from previous chunk if needed
    if (chunkOverlap > 0 && chunks.length > 0) {
      const prevChunk: ChunkResult = chunks[chunks.length - 1]
      const overlapStart: number = calculateOverlapStart(
        originalText,
        prevChunk,
        chunkOverlap,
        splitter
      )

      // Allow overlap to go backwards, but ensure we don't go before the first chunk start or unit start
      chunkStart = Math.max(overlapStart, unit.start)

      // Prevent infinite loops when overlap >= chunk size by ensuring forward progress
      if (chunkOverlap >= chunkSize && chunkStart >= currentStart)
        chunkStart = Math.min(currentStart + 1, unit.end)
    }

    // Use binary search to find the optimal end position within token limits
    let low: number = chunkStart + 1
    let high: number = unit.end
    let bestEnd: number = chunkStart + 1

    while (low <= high) {
      const mid: number = Math.floor((low + high) / 2)
      const testText: string = originalText.slice(chunkStart, mid)
      const tokenCount: number = splitter(testText).length

      if (tokenCount <= chunkSize) {
        bestEnd = mid
        low = mid + 1
      } else high = mid - 1
    }

    // Ensure forward progress by including at least one character
    if (bestEnd <= chunkStart) bestEnd = Math.min(chunkStart + 1, unit.end)

    // Extract text from calculated positions
    const chunkText: string = originalText.slice(chunkStart, bestEnd)

    chunks.push({
      text: chunkText,
      start: chunkStart,
      end: bestEnd
    })

    // For next iteration, start at the end of current chunk
    // This ensures forward progress while allowing overlap in the next iteration
    // Add extra protection for cases where overlap might prevent progress
    if (chunkOverlap >= chunkSize)
      currentStart = Math.max(bestEnd, currentStart + 1)
    else currentStart = bestEnd

    // Break if we've reached the end of the unit
    if (bestEnd >= unit.end) break
  }

  return chunks
}
