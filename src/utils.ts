import { ChunkResult, ChunkUnit } from './types.js'

/**
 * Extracts text units (paragraphs) from input text by splitting on double newlines.
 * @param text - The input text to split into paragraph units.
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
    const unit: string = text.slice(lastIndex, end).trim()
    // Store non-empty paragraphs with their character positions
    if (unit) units.push({ unit, start: lastIndex, end })
    // Move past the current separator for next iteration
    lastIndex = regex.lastIndex
  }
  // Handle the final paragraph after the last separator
  const lastUnit: string = text.slice(lastIndex).trim()
  if (lastUnit)
    units.push({ unit: lastUnit, start: lastIndex, end: text.length })
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
 * - Prevents duplicate/redundant final chunks when content is already covered by overlap
 * - Uses precise token-based overlap that can break paragraph boundaries for exact control
 * - Prioritizes exact overlap token count over paragraph boundary preservation
 * - Use `chunkByCharacter` for character-level control or if paragraph boundaries must be preserved
 *
 * @param chunkUnits - Array of paragraph units with their text and character positions.
 * @param splitter - Function to split text into tokens for size calculation.
 * @param chunkSize - Maximum size of each chunk in tokens.
 * @param chunkOverlap - Exact number of tokens to overlap between chunks.
 * @returns Array of chunk objects with text and character positions.
 */
export function chunkByParagraph(
  chunkUnits: ChunkUnit[],
  splitter: (text: string) => string[],
  chunkSize: number,
  chunkOverlap: number
): ChunkResult[] {
  let i: number = 0
  const n: number = chunkUnits.length
  const chunks: ChunkResult[] = []

  while (i < n) {
    let currentLen: number = 0
    let j: number = i
    let overlapText: string = ''
    let overlapTokenCount: number = 0

    // Calculate overlap text from previous chunk if needed
    if (chunkOverlap > 0 && chunks.length > 0) {
      const prevChunk: ChunkResult = chunks[chunks.length - 1]
      const prevChunkTokens: string[] = splitter(prevChunk.text as string)

      if (prevChunkTokens.length >= chunkOverlap) {
        const overlapTokens: string[] = prevChunkTokens.slice(-chunkOverlap)
        overlapText = overlapTokens.join('')
        overlapTokenCount = overlapTokens.length
        // Start with overlap tokens counted towards chunk size
        currentLen = overlapTokenCount
      }
    }

    // Expand window to include as many complete paragraphs as possible
    while (j < n) {
      const unitLen: number = splitter(chunkUnits[j].unit).length
      const simulatedLen: number = currentLen + unitLen

      // Stop expanding if adding this paragraph would exceed the limit
      if (simulatedLen > chunkSize && j > i) break

      // Handle oversized single paragraph by breaking it into sub-chunks
      if (simulatedLen > chunkSize && j === i) {
        // For single large paragraph, we need to handle overlap differently
        const subChunks: ChunkResult[] = chunkSingleParagraph(
          chunkUnits[i],
          splitter,
          chunkSize,
          chunkOverlap
        )

        // If we have overlap, prepend it to the first sub-chunk
        if (overlapText && subChunks.length > 0) {
          const firstSubChunk: ChunkResult = subChunks[0]
          subChunks[0] = {
            ...firstSubChunk,
            text: overlapText + '\n\n' + firstSubChunk.text
          }
        }

        chunks.push(...subChunks)
        // Move to next paragraph after processing sub-chunks
        i++
        continue
      }
      // Accept this paragraph and continue expanding
      currentLen = simulatedLen
      j++
    }

    // Create chunk from the selected paragraph range
    if (j > i) {
      const chunkStr: string = chunkUnits
        .slice(i, j)
        .map((u: ChunkUnit) => u.unit)
        .join('\n\n')

      let finalChunkText: string = chunkStr
      let chunkStart: number = chunkUnits[i].start
      let chunkEnd: number = chunkUnits[j - 1].end

      // Add overlap text if we have it
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
      }

      chunks.push({
        text: finalChunkText,
        start: chunkStart,
        end: chunkEnd
      })
    }

    // Move to next set of paragraphs
    i = j
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
