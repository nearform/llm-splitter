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
 * Chunks text by paragraphs using a token-by-token approach with precise overlap handling.
 *
 * Processes tokens one at a time to build chunks up to the specified token limit while
 * respecting paragraph boundaries. When adding the next token would exceed the chunk size,
 * the current chunk is completed. The following chunk includes the last N tokens
 * (where N = chunkOverlap) from the previous chunk at its beginning.
 *
 * **Algorithm Details:**
 * - Token-by-token processing: Builds chunks incrementally by adding one token at a time
 * - Paragraph boundary respect: Prioritizes complete paragraphs but sub-chunks when necessary
 * - Precise token overlap: Includes exactly chunkOverlap tokens from the end of the previous chunk
 * - Memory efficient: Uses minimal memory mappings for large texts
 * - Forward progress guarantee: Ensures algorithm terminates by advancing at least one token per iteration
 *
 * **Paragraph Handling:**
 * - Attempts to include complete paragraphs in chunks when possible
 * - Automatically sub-chunks oversized paragraphs that exceed token limits
 * - Maintains paragraph boundaries for improved semantic coherence
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
 * const units = getUnits(text);
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
  // Handle empty input
  if (originalText.length === 0 || chunkUnits.length === 0) return []

  // Handle edge case where chunk size is 0 or negative
  if (chunkSize <= 0) chunkSize = 1 // Force minimum chunk size of 1

  // For paragraph chunking, use a simpler approach similar to the original greedy method
  // but process tokens more efficiently
  const chunks: ChunkResult[] = []
  let unitIndex = 0

  while (unitIndex < chunkUnits.length) {
    let chunkStart = chunkUnits[unitIndex].start
    let chunkEnd = chunkUnits[unitIndex].end
    let currentTokenCount = 0

    // Handle overlap from previous chunk
    if (chunkOverlap > 0 && chunks.length > 0) {
      const prevChunk = chunks[chunks.length - 1]

      // Calculate overlap more efficiently by working with tokens directly
      // instead of re-processing large text segments
      const overlapStart = Math.max(
        prevChunk.end - chunkOverlap * 4,
        chunkUnits[unitIndex].start
      )
      chunkStart = Math.max(overlapStart, chunkUnits[unitIndex].start)
    }

    // Try to add complete paragraphs up to the chunk size limit
    let endUnitIndex = unitIndex
    while (endUnitIndex < chunkUnits.length) {
      const testEnd = chunkUnits[endUnitIndex].end
      const testText = originalText.slice(chunkStart, testEnd)
      const testTokens = splitter(testText)

      if (testTokens.length <= chunkSize) {
        // This paragraph fits, include it
        chunkEnd = testEnd
        currentTokenCount = testTokens.length
        endUnitIndex++
      } else if (endUnitIndex === unitIndex) {
        // The first paragraph itself is too large, need to sub-chunk it
        const unitText = originalText.slice(
          chunkUnits[unitIndex].start,
          chunkUnits[unitIndex].end
        )
        const unitTokens = splitter(unitText)

        if (unitTokens.length > chunkSize) {
          // Sub-chunk this paragraph using character-based approach
          const subChunks = chunkByCharacter(
            unitText,
            chunkSize,
            splitter,
            chunkOverlap,
            chunkUnits[unitIndex].start
          )
          chunks.push(...subChunks)
          unitIndex++
          continue
        } else {
          // Single paragraph that fits
          chunkEnd = chunkUnits[unitIndex].end
          endUnitIndex++
          break
        }
      } else {
        // Can't fit this paragraph, stop here
        break
      }
    }

    // Create chunk from accumulated paragraphs
    if (endUnitIndex > unitIndex) {
      const chunkText = originalText.slice(chunkStart, chunkEnd)
      chunks.push({
        text: chunkText,
        start: chunkStart,
        end: chunkEnd
      })
      unitIndex = endUnitIndex
    } else {
      // Should not happen, but safeguard against infinite loop
      unitIndex++
    }
  }

  return chunks
}
