import { ChunkResult, ChunkUnit } from './types.js'

/**
 * Get text units based on the specified strategy.
 * @param text - The input text to split into units.
 * @returns An array of text units with their start and end positions.
 */
export function getUnits(text: string): ChunkUnit[] {
  const units: ChunkUnit[] = []
  const regex: RegExp = /\n{2,}/g
  let lastIndex: number = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const end: number = match.index
    const unit: string = text.slice(lastIndex, end).trim()
    if (unit) units.push({ unit, start: lastIndex, end })
    lastIndex = regex.lastIndex
  }
  const lastUnit: string = text.slice(lastIndex).trim()
  if (lastUnit)
    units.push({ unit: lastUnit, start: lastIndex, end: text.length })
  return units
}

/**
 * Chunk the text by character count, with optional overlapping.
 *
 * @param currentText - The text to chunk.
 * @param chunkSize - Maximum size of each chunk.
 * @param splitter - Function to split the text into units.
 * @param chunkOverlap - Number of characters to overlap between chunks.
 * @param startOffset - Starting character position offset for calculating absolute positions.
 * @returns Array of chunk objects with text and positions.
 */
export function chunkByCharacter(
  currentText: string,
  chunkSize: number,
  splitter: (text: string) => string[],
  chunkOverlap: number,
  startOffset: number = 0
): ChunkResult[] {
  let start = 0
  const textLen = currentText.length
  const chunks: ChunkResult[] = []
  while (start < textLen) {
    // Binary search for the largest end such that splitter(currentText.slice(start, end)).length <= chunkSize
    let low = start + 1
    let high = textLen
    let bestEnd = start + 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const len = splitter(currentText.slice(start, mid)).length
      if (len <= chunkSize) {
        bestEnd = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    // Ensure at least one character per chunk
    if (bestEnd === start) bestEnd = Math.min(start + 1, textLen)
    chunks.push({
      text: currentText.slice(start, bestEnd),
      start: startOffset + start,
      end: startOffset + bestEnd
    })
    if (bestEnd >= textLen) break
    if (chunkOverlap > 0 && bestEnd > start)
      start = Math.max(bestEnd - chunkOverlap, start + 1)
    else start = bestEnd
  }
  return chunks
}

/**
 * Generator function to yield chunks of text based on a greedy sliding window approach.
 * Each chunk will overlap with the previous chunk by `chunkOverlap` tokens (if provided).
 *
 * @param chunkUnits - Array of chunk units (paragraphs) with their text and positions.
 * @param splitter - Function to split the text into tokens.
 * @param chunkSize - Maximum size of each chunk in tokens.
 * @param chunkOverlap - Number of tokens to overlap between chunks.
 * @returns Array of chunk objects with text and positions.
 */
export function chunkByParagraph(
  chunkUnits: ChunkUnit[],
  splitter: (text: string) => string[],
  chunkSize: number,
  chunkOverlap: number
): ChunkResult[] {
  let i = 0
  const n = chunkUnits.length
  const chunks: ChunkResult[] = []
  const joiner = '\n\n'
  const joinerLen = splitter(joiner).length

  while (i < n) {
    let currentLen = 0
    let first = true
    let j = i

    // Find the maximal window [i, j) that fits within chunkSize
    while (j < n) {
      const unitLen = splitter(chunkUnits[j].unit).length
      const simulatedLen = currentLen + (first ? 0 : joinerLen) + unitLen

      if (simulatedLen > chunkSize && j > i) break
      if (simulatedLen > chunkSize && j === i) {
        // Force at least one unit per chunk
        j++
        break
      }
      currentLen = simulatedLen
      first = false
      j++
    }

    if (j > i) {
      const chunkStr = chunkUnits
        .slice(i, j)
        .map(u => u.unit)
        .join(joiner)
      chunks.push({
        text: chunkStr,
        start: chunkUnits[i].start,
        end: chunkUnits[j - 1].end
      })
    }

    // Calculate overlap and advance window
    if (chunkOverlap > 0 && j > i) {
      // Move backward by chunkOverlap units from the end of current chunk
      // But ensure we always make progress to avoid infinite loop
      const overlapStart = Math.max(i + 1, j - chunkOverlap)
      i = overlapStart
    } else {
      i = j
    }
  }

  return chunks
}
