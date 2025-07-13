import { ChunkResult, ChunkUnit } from './types.js'

/**
 * Extracts text units (paragraphs) from input text by splitting on double newlines.
 * @param text - The input text t      // Add overlap text if we have it
      if (overlapText) {
        finalChunkText = overlapText + '\n\n' + chunkStr

        // Calculate the character position where overlap starts in the original text
        const prevChunk: ChunkResult = chunks[chunks.length - 1]
        const prevChunkText: string = prevChunk.text as string
        const prevTokens: string[] = splitter(prevChunkText)
        const preOverlapTokens: string[] = prevTokens.slice(0, -chunkOverlap)
        const preOverlapText: string = preOverlapTokens.join('')

        // Adjust start position to account for overlap
        chunkStart = prevChunk.start + preOverlapText.length
      }graph units.
 * @returns An array of paragraph units with their character positions in the original text.
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
    const unit: string = rawUnit.trim()

    // Store non-empty paragraphs with their character positions
    if (unit) {
      // Calculate the actual start position after trimming
      const trimmedStart = lastIndex + rawUnit.indexOf(unit)
      const trimmedEnd = trimmedStart + unit.length
      units.push({ unit, start: trimmedStart, end: trimmedEnd })
    }
    // Move past the current separator for next iteration
    lastIndex = regex.lastIndex
  }
  // Handle the final paragraph after the last separator
  const rawLastUnit: string = text.slice(lastIndex)
  const lastUnit: string = rawLastUnit.trim()
  if (lastUnit) {
    // Calculate the actual start position after trimming
    const trimmedStart = lastIndex + rawLastUnit.indexOf(lastUnit)
    const trimmedEnd = trimmedStart + lastUnit.length
    units.push({ unit: lastUnit, start: trimmedStart, end: trimmedEnd })
  }
  return units
}

/**
 * Chunks text using a sliding window approach with token-based size calculation.
 * Uses binary search to find optimal chunk boundaries that respect token limits.
 *
 * @param currentText - The text to chunk.
 * @param chunkSize - Maximum size of each chunk in tokens.
 * @param splitter - Function to split text into tokens for size calculation.
 * @param chunkOverlap - Number of tokens to overlap between chunks.
 * @param startOffset - Starting character position offset for calculating absolute positions.
 * @returns Array of chunk objects with text and character positions.
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
 * Chunks text by paragraphs using a greedy sliding window approach.
 * Attempts to fit as many complete paragraphs as possible within the token limit.
 * When a single paragraph exceeds the limit, it's automatically broken into sub-chunks.
 *
 * **Important Behaviors**:
 * - Uses position-accurate overlap that maintains split/getChunk consistency
 * - Calculates overlap boundaries using actual character positions in original text
 * - Ensures overlapped chunks can be retrieved exactly via getChunk()
 * - Preserves paragraph boundaries when possible while respecting token limits
 *
 * @param originalText - The original text to extract chunks from.
 * @param chunkUnits - Array of paragraph units with their positions.
 * @param chunkSize - Maximum size of each chunk in tokens.
 * @param chunkOverlap - Number of tokens to overlap between chunks.
 * @param splitter - Function to split text into tokens for size calculation.
 * @returns Array of chunk objects with text and character positions.
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
      overlapStart = calculateOverlapStart(originalText, prevChunk, chunkOverlap, splitter)
      
      // Count overlap tokens toward current chunk size
      const overlapText: string = originalText.slice(overlapStart, prevChunk.end)
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
      const finalChunkStart: number = (chunkOverlap > 0 && chunks.length > 0) ? overlapStart : chunkStart
      
      // Extract text directly from original positions to ensure consistency
      const finalChunkText: string = originalText.slice(finalChunkStart, chunkEnd)

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
 * Calculates the character position where overlap should start based on token count.
 * Uses binary search to find the exact character position that corresponds to the 
 * desired number of overlap tokens from the end of the previous chunk.
 *
 * @param originalText - The original text to extract from.
 * @param prevChunk - The previous chunk to calculate overlap from.
 * @param chunkOverlap - Number of tokens to overlap.
 * @param splitter - Function to split text into tokens.
 * @returns Character position where overlap should start.
 */
function calculateOverlapStart(
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
 * @param originalText - The original text to extract from.
 * @param unit - The paragraph unit that needs to be sub-chunked.
 * @param splitter - Function to split text into tokens.
 * @param chunkSize - Maximum size of each sub-chunk in tokens.
 * @param chunkOverlap - Number of tokens to overlap between sub-chunks.
 * @param firstChunkStart - Starting position for the first sub-chunk (may include overlap from previous chunk).
 * @returns Array of sub-chunk objects with text and character positions.
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
  
  // Calculate offset if first chunk starts before the unit (due to overlap)
  const startOffset: number = firstChunkStart - unit.start
  
  while (tokenIndex < tokens.length) {
    let currentChunkSize: number = 0
    let chunkStart: number
    let overlapTokenCount: number = 0
    
    // Calculate overlap for subsequent chunks
    if (chunks.length > 0 && chunkOverlap > 0) {
      const prevChunk: ChunkResult = chunks[chunks.length - 1]
      chunkStart = calculateOverlapStart(originalText, prevChunk, chunkOverlap, splitter)
      
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

/**
 * Breaks a single paragraph that exceeds the chunk size limit into smaller sub-chunks.
 * Maintains token-based overlap between sub-chunks and accurate character position tracking.
 *
 * @param unit - The paragraph unit that needs to be sub-chunked.
 * @param splitter - Function to split text into tokens.
 * @param chunkSize - Maximum size of each sub-chunk in tokens.
 * @param chunkOverlap - Number of tokens to overlap between sub-chunks.
 * @returns Array of sub-chunk objects with text and character positions.
 */
function chunkSingleParagraph(
  unit: ChunkUnit,
  splitter: (text: string) => string[],
  chunkSize: number,
  chunkOverlap: number
): ChunkResult[] {
  const tokens: string[] = splitter(unit.unit)
  const chunks: ChunkResult[] = []
  let tokenIndex: number = 0

  while (tokenIndex < tokens.length) {
    let chunkTokens: string[] = []
    let currentChunkSize: number = 0
    let overlapTokens: string[] = []

    // Include overlap tokens from the previous chunk for continuity
    if (chunks.length > 0 && chunkOverlap > 0) {
      const overlapStart: number = Math.max(0, tokenIndex - chunkOverlap)
      for (let k: number = overlapStart; k < tokenIndex; k++) {
        overlapTokens.push(tokens[k])
        currentChunkSize++
      }
      // Initialize chunk with overlap tokens
      chunkTokens = [...overlapTokens]
    }

    // Fill chunk with new tokens until reaching the size limit
    while (tokenIndex < tokens.length && currentChunkSize < chunkSize) {
      chunkTokens.push(tokens[tokenIndex])
      currentChunkSize++
      tokenIndex++
    }

    // Reconstruct text from the selected tokens
    const chunkText: string = chunkTokens.join('')

    // Calculate accurate character positions within the original unit
    let chunkStart: number
    let chunkEnd: number

    if (chunks.length === 0) {
      // Position first chunk at the beginning of the unit
      chunkStart = unit.start
      chunkEnd = unit.start + chunkText.length
    } else {
      // Position subsequent chunks accounting for overlap
      const prevChunkEnd: number = chunks[chunks.length - 1].end
      chunkStart = prevChunkEnd - overlapTokens.join('').length
      chunkEnd = chunkStart + chunkText.length
    }

    chunks.push({
      text: chunkText,
      start: chunkStart,
      // Ensure we don't exceed the original unit boundaries
      end: Math.min(chunkEnd, unit.end)
    })

    // Prevent infinite loops by forcing advancement when no progress is made
    if (currentChunkSize === 0) {
      tokenIndex++
    }
  }

  return chunks
}
