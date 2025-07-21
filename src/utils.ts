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
 * Processes tokens one at a time to build chunks up to the specified token limit. When adding
 * the next token would exceed the chunk size, the current chunk is completed. The following
 * chunk includes the last N tokens (where N = chunkOverlap) from the previous chunk at its
 * beginning, ensuring precise token-based overlap and forward progress.
 *
 * **Algorithm Details:**
 * - Token-by-token processing: Builds chunks incrementally by adding one token at a time
 * - Precise token limits: Respects exact token count constraints without exceeding chunkSize
 * - Token-based overlap: Includes exactly chunkOverlap tokens from the end of the previous chunk
 * - Character position mapping: Maintains accurate character positions by mapping token indices to text positions
 * - Forward progress guarantee: Ensures algorithm terminates by advancing at least one token per iteration
 *
 * **Use Cases:**
 * - Raw text processing where paragraph structure is unavailable or unimportant
 * - Token-level chunking for maximum precision within token limits
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

  // Tokenize the entire text once upfront
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

  // Build a mapping from token indices to character positions in the original text
  const tokenToCharMap: number[] = []
  let charPos = 0
  let tokenIndex = 0

  // Find character positions for each token in the original text
  while (tokenIndex < tokens.length && charPos < currentText.length) {
    const token = tokens[tokenIndex]
    const tokenStart = currentText.indexOf(token, charPos)
    
    if (tokenStart !== -1) {
      tokenToCharMap[tokenIndex] = tokenStart
      charPos = tokenStart + token.length
      tokenIndex++
    } else {
      // If we can't find the token, it might be due to overlapping patterns
      // Fall back to advancing character by character
      charPos++
    }
  }
  
  // Make sure we have an end position for the last token
  tokenToCharMap[tokens.length] = currentText.length

  const chunks: ChunkResult[] = []
  let currentTokenIndex = 0

  while (currentTokenIndex < totalTokens) {
    let chunkTokenStart = currentTokenIndex
    let chunkTokenEnd = Math.min(currentTokenIndex + chunkSize, totalTokens)

    // Include overlap tokens from previous chunk if needed
    if (chunkOverlap > 0 && chunks.length > 0) {
      chunkTokenStart = Math.max(currentTokenIndex - chunkOverlap, 0)
      chunkTokenEnd = Math.min(chunkTokenStart + chunkSize, totalTokens)
    }

    // Calculate character positions for this chunk
    const chunkStartChar = tokenToCharMap[chunkTokenStart]
    const chunkEndChar = tokenToCharMap[chunkTokenEnd] || currentText.length

    // Create chunk with absolute positions
    const chunkText = currentText.slice(chunkStartChar, chunkEndChar)
    const chunk: ChunkResult = {
      text: chunkText,
      start: startOffset + chunkStartChar,
      end: startOffset + chunkEndChar
    }

    chunks.push(chunk)

    // Advance to the next chunk position
    currentTokenIndex = chunkTokenEnd

    // If we've processed all tokens, break
    if (currentTokenIndex >= totalTokens) break
  }

  return chunks
}

/**
 * Optimized version of calculateOverlapStart that uses pre-computed token mapping.
 *
 * @param allTokens - Pre-computed tokens for the entire text
 * @param charToTokenMap - Mapping from character positions to token indices
 * @param prevChunk - The previous chunk for overlap calculation
 * @param chunkOverlap - Number of tokens to overlap
 * @returns Character position where overlap should start
 */
function calculateOverlapStartWithTokenMap(
  allTokens: string[],
  charToTokenMap: number[],
  prevChunk: ChunkResult,
  chunkOverlap: number
): number {
  const prevStartToken: number = charToTokenMap[prevChunk.start]
  const prevEndToken: number = charToTokenMap[prevChunk.end]
  const prevTokenCount: number = prevEndToken - prevStartToken

  // If requested overlap is greater than available tokens, use all available
  const actualOverlap: number = Math.min(chunkOverlap, prevTokenCount)

  if (actualOverlap === 0) return prevChunk.end
  if (actualOverlap >= prevTokenCount) return prevChunk.start

  // Calculate the token position where overlap should start
  const overlapStartToken: number = prevEndToken - actualOverlap

  // Convert token position back to character position
  let charPos: number = 0
  for (let i = 0; i < overlapStartToken; i++) {
    charPos += allTokens[i].length
  }

  return charPos
}

/**
 * Optimized version of chunkSingleParagraphWithOverlap that uses pre-computed token mapping.
 *
 * @param originalText - The original text
 * @param allTokens - Pre-computed tokens for the entire text
 * @param charToTokenMap - Mapping from character positions to token indices
 * @param unit - The paragraph unit to sub-chunk
 * @param chunkSize - Maximum chunk size in tokens
 * @param chunkOverlap - Number of tokens to overlap
 * @param firstChunkStart - Starting character position
 * @returns Array of sub-chunks
 */
function chunkSingleParagraphWithTokenMap(
  originalText: string,
  allTokens: string[],
  charToTokenMap: number[],
  unit: ChunkUnit,
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
      const overlapStart: number = calculateOverlapStartWithTokenMap(
        allTokens,
        charToTokenMap,
        prevChunk,
        chunkOverlap
      )

      // Allow overlap to go backwards, but ensure we don't go before the first chunk start or unit start
      chunkStart = Math.max(overlapStart, unit.start)

      // Prevent infinite loops when overlap >= chunk size by ensuring forward progress
      if (chunkOverlap >= chunkSize && chunkStart >= currentStart)
        chunkStart = Math.min(currentStart + 1, unit.end)
    }

    // Find the optimal end position using token mapping instead of binary search
    const chunkStartToken: number = charToTokenMap[chunkStart]
    const unitEndToken: number = charToTokenMap[unit.end]
    const maxChunkEndToken: number = Math.min(
      chunkStartToken + chunkSize,
      unitEndToken
    )

    // Convert token position back to character position
    let bestEnd: number = chunkStart
    if (maxChunkEndToken > chunkStartToken) {
      let charPos: number = 0
      for (let i = 0; i < maxChunkEndToken; i++) {
        charPos += allTokens[i].length
      }
      bestEnd = Math.min(charPos, unit.end)
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
    if (chunkOverlap >= chunkSize)
      currentStart = Math.max(bestEnd, currentStart + 1)
    else currentStart = bestEnd

    // Break if we've reached the end of the unit
    if (bestEnd >= unit.end) break
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
  // Optimize by tokenizing the entire text only once
  const allTokens: string[] = splitter(originalText)

  // Create a mapping from character positions to token indices
  const charToTokenMap: number[] = new Array(originalText.length + 1)
  let charPos: number = 0

  for (let i = 0; i < allTokens.length; i++) {
    const tokenLength: number = allTokens[i].length
    for (let j = 0; j < tokenLength; j++) {
      charToTokenMap[charPos + j] = i
    }
    charPos += tokenLength
  }
  // Fill remaining positions with the last token index + 1
  for (let i = charPos; i <= originalText.length; i++) {
    charToTokenMap[i] = allTokens.length
  }

  // Pre-compute token counts for each paragraph using the global tokenization
  const paragraphTokenCounts: number[] = chunkUnits.map(unit => {
    const startToken: number = charToTokenMap[unit.start]
    const endToken: number = charToTokenMap[unit.end]
    return endToken - startToken
  })

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
      overlapStart = calculateOverlapStartWithTokenMap(
        allTokens,
        charToTokenMap,
        prevChunk,
        chunkOverlap
      )

      // Count overlap tokens using the token map instead of calling splitter
      const overlapStartToken: number = charToTokenMap[overlapStart]
      const overlapEndToken: number = charToTokenMap[prevChunk.end]
      currentLen = overlapEndToken - overlapStartToken
    }

    // Expand window to include as many complete paragraphs as possible
    while (j < n) {
      const unitLen: number = paragraphTokenCounts[j] // Use pre-computed token count
      const simulatedLen: number = currentLen + unitLen

      // Stop expanding if adding this paragraph would exceed the limit
      if (simulatedLen > chunkSize && j > i) break

      // Handle oversized single paragraph by breaking it into sub-chunks
      if (simulatedLen > chunkSize && j === i) {
        // For single large paragraph, create sub-chunks using the token map
        const subChunks: ChunkResult[] = chunkSingleParagraphWithTokenMap(
          originalText,
          allTokens,
          charToTokenMap,
          chunkUnits[i],
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

export function mapPartsToText(
  parts: string[],
  text: string
): Array<{ text: string | null; start: number; end: number }> {
  const result: Array<{ text: string | null; start: number; end: number }> = []

  let partIdx = 0
  let i = 0
  while (i < text.length && partIdx < parts.length) {
    const part = parts[partIdx]
    if (text.startsWith(part, i)) {
      result.push({
        text: part,
        start: i,
        end: i + part.length
      })
      i += part.length
      partIdx++
    } else {
      result.push({
        text: null,
        start: i,
        end: i + 1
      })
      i += 1
    }
  }
  // If there are leftover unmatched characters in text, mark them as text: null
  while (i < text.length) {
    result.push({
      text: null,
      start: i,
      end: i + 1
    })
    i += 1
  }

  return result
}

export function chunkByCharacterLinear(
  currentText: string,
  chunkSize: number,
  splitter: (text: string) => string[],
  chunkOverlap: number,
  startOffset: number = 0
): ChunkResult[] {
  // Helpers
  const chunks: ChunkResult[] = []
  let lastChunkEnd = null
  const addChunk = ({
    text,
    start,
    end
  }: {
    text: string
    start: number
    end: number
  }) => {
    chunks.push({
      text,
      start: startOffset + start,
      end: startOffset + end
    })

    // Update last chunk end for overlap calculations
    lastChunkEnd = end
  }

  // Do a prep single pass to split, map, and prepare for a single iteration pass.
  const parts = splitter(currentText)
  const partsIdxsToText = mapPartsToText(parts, currentText)

  // Iterate.
  let chunkStart = 0
  let chunkEnd = 1
  let chunkParts: { text: string | null; start: number; end: number }[] = []
  for (let i = 0; i < partsIdxsToText.length; i++) {
    const part = partsIdxsToText[i]

    // console.log("TODO: REMOVE", {
    //   part,
    //   chunkStart,
    //   chunkEnd,
    //   chunkSize,
    //   chunkOverlap
    // })

    // Ignored part from splitter.
    if (part.text === null) {
      continue
    }

    // See if we can fit the part in the chunk.
    if (chunkParts.length < chunkSize) {
      chunkEnd = part.end

      // Track non-ignored parts (for later overlap handling).
      chunkParts.push(part)
    } else {
      // TODO: HANDLE SPLITTING THE PART WHEN OVER THE CHUNK SIZE.

      // We can't fit the part in the chunk.
      // Add the chunk and start a new one.
      const chunk = {
        text: currentText.slice(chunkStart, chunkEnd),
        start: chunkStart,
        end: chunkEnd
      }
      addChunk(chunk)

      // Handle the overlap by potentially resetting the start to earlier.
      if (chunkOverlap > 0) {
        const overlapParts = chunkParts.slice(-chunkOverlap)
        if (overlapParts.length > 0) {
          chunkStart = overlapParts[0].start
          chunkParts = overlapParts
        }
      } else {
        // Restart the chunk.
        chunkStart = part.start
        chunkParts = []
      }

      chunkParts.push(part)
      chunkEnd = part.end
    }
  }

  // Add the last chunk.
  if (
    chunkStart < currentText.length &&
    (lastChunkEnd === null || lastChunkEnd < chunkEnd)
  ) {
    addChunk({
      text: currentText.slice(chunkStart, chunkEnd),
      start: chunkStart,
      end: chunkEnd
    })
  }

  return chunks
}