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
 * **Important**: This function prevents duplicate/redundant final chunks. If the remaining
 * content is already fully covered by the previous chunk with overlap, no additional 
 * chunk will be created. This ensures efficient chunking without unnecessary duplication.
 *
 * @param chunkUnits - Array of paragraph units with their text and character positions.
 * @param splitter - Function to split text into tokens for size calculation.
 * @param chunkSize - Maximum size of each chunk in tokens.
 * @param chunkOverlap - Number of tokens to overlap between chunks.
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

    // Expand window to include as many complete paragraphs as possible
    while (j < n) {
      const unitLen: number = splitter(chunkUnits[j].unit).length
      const simulatedLen: number = currentLen + unitLen

      // Stop expanding if adding this paragraph would exceed the limit
      if (simulatedLen > chunkSize && j > i) break
      // Handle oversized single paragraph by breaking it into sub-chunks
      if (simulatedLen > chunkSize && j === i) {
        const subChunks: ChunkResult[] = chunkSingleParagraph(
          chunkUnits[i],
          splitter,
          chunkSize,
          chunkOverlap
        )
        chunks.push(...subChunks)
        i++
        continue
      }
      currentLen = simulatedLen
      j++
    }

    // Create chunk from the selected paragraph range
    if (j > i) {
      const chunkStr: string = chunkUnits
        .slice(i, j)
        .map(u => u.unit)
        .join('\n\n')
      chunks.push({
        text: chunkStr,
        start: chunkUnits[i].start,
        end: chunkUnits[j - 1].end
      })
    }

    // Advance window position considering token-based overlap
    if (chunkOverlap > 0 && j > i && chunks.length > 0) {
      // Calculate where to start the next chunk based on token overlap
      const lastChunkText: string = chunks[chunks.length - 1].text as string
      const lastChunkTokens: string[] = splitter(lastChunkText)
      
      // If we can overlap by the requested amount within the last chunk, do so
      if (lastChunkTokens.length >= chunkOverlap) {
        // We need to find which paragraph units contain the overlap tokens
        let remainingOverlap: number = chunkOverlap
        let nextStartIndex: number = j
        
        // Work backwards through the units in the current chunk
        for (let k = j - 1; k >= i && remainingOverlap > 0; k--) {
          const unitTokens: string[] = splitter(chunkUnits[k].unit)
          if (unitTokens.length <= remainingOverlap) {
            // This entire unit should be included in the overlap
            remainingOverlap -= unitTokens.length
            nextStartIndex = k
          } else {
            // Only part of this unit is needed for overlap, but since we work with whole units,
            // include the whole unit if it helps achieve the overlap
            nextStartIndex = k
            break
          }
        }
        
        // Ensure we make progress and that there's actually content to process
        const proposedStart = Math.max(nextStartIndex, i + 1)
        
        // Check if there are remaining units to process beyond the proposed start
        if (proposedStart < n) {
          // Calculate if the remaining content would create a meaningful chunk
          let remainingContentTokens = 0
          for (let k = proposedStart; k < n; k++) {
            remainingContentTokens += splitter(chunkUnits[k].unit).length
          }
          
          // Only create a new chunk if there's enough remaining content
          // and it's not entirely contained in the previous chunk
          if (remainingContentTokens > 0) {
            const nextChunkEnd = chunkUnits[n - 1].end
            const lastChunkEnd = chunks[chunks.length - 1].end
            
            // Don't create overlapping chunk if the content is already fully contained
            if (nextChunkEnd > lastChunkEnd) {
              i = proposedStart
            } else {
              i = j // Skip creating duplicate chunk
            }
          } else {
            i = j // No meaningful content left
          }
        } else {
          i = j // No more units to process
        }
      } else {
        // If last chunk is smaller than overlap, just move forward by 1
        i = Math.max(j - 1, i + 1)
      }
    } else {
      i = j
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
      end: Math.min(chunkEnd, unit.end)
    })

    // Prevent infinite loops by forcing advancement when no progress is made
    if (currentChunkSize === 0) {
      tokenIndex++
    }
  }

  return chunks
}
