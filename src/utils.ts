import { ChunkUnit } from './types.js'

/**
 * Get the length of a text based on the provided length function or default to character count.
 * @param text - The input text.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @returns The length of the text.
 */
export function getLength(
  text: string,
  lengthFunction?: (text: string) => number
): number {
  return lengthFunction?.(text) ?? text.length
}

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
 * Check if all chunk units can fit within the specified chunk size.
 * @param chunkUnits - Array of chunk units with their text and positions.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @param chunkSize - Maximum size of each chunk.
 * @param joinerLen - Length of the joiner string used to combine units.
 * @returns True if all units can fit, false otherwise.
 */
export function canFitAllUnits(
  chunkUnits: ChunkUnit[],
  lengthFunction: ((text: string) => number) | undefined,
  chunkSize: number,
  joinerLen: number
): boolean {
  return (
    chunkUnits.every(u => getLength(u.unit, lengthFunction) <= chunkSize) &&
    chunkUnits.reduce(
      (acc: number, u: { unit: string }, i: number) =>
        acc + getLength(u.unit, lengthFunction) + (i > 0 ? joinerLen : 0),
      0
    ) <= chunkSize
  )
}

/**
 * Chunk the text by character count, with optional overlapping.
 *
 * @param currentText - The text to chunk.
 * @param chunkSize - Maximum size of each chunk.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @param chunkOverlap - Number of characters to overlap between chunks.
 * @param startOffset - Starting character position offset for calculating absolute positions.
 * @returns Array of chunk objects with text and positions.
 */
export function chunkByCharacter(
  currentText: string,
  chunkSize: number,
  lengthFunction: ((text: string) => number) | undefined,
  chunkOverlap: number,
  startOffset: number = 0
): { text: string; start: number; end: number }[] {
  let start = 0
  const textLen = currentText.length
  const chunks: { text: string; start: number; end: number }[] = []
  while (start < textLen) {
    // Binary search for the largest end such that getLength(currentText.slice(start, end)) <= chunkSize
    let low = start + 1
    let high = textLen
    let bestEnd = start + 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const len = getLength(currentText.slice(start, mid), lengthFunction)
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
 * Each chunk will overlap with the previous chunk by `chunkOverlap` characters (if provided).
 *
 * @param chunkUnits - Array of chunk units (paragraphs) with their text and positions.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @param joinerLen - Length of the joiner string used to combine units.
 * @param chunkSize - Maximum size of each chunk.
 * @param joiner - String used to join units into a chunk.
 * @param chunkOverlap - Number of characters to overlap between chunks.
 * @returns Array of chunk objects with text and positions.
 */
export function chunkByGreedySlidingWindow(
  chunkUnits: ChunkUnit[],
  lengthFunction: ((text: string) => number) | undefined,
  joinerLen: number,
  chunkSize: number,
  joiner: string,
  chunkOverlap: number
): { text: string; start: number; end: number }[] {
  let i = 0
  const n = chunkUnits.length
  const chunks: { text: string; start: number; end: number }[] = []
  while (i < n) {
    let currentLen = 0
    let first = true
    let j = i
    // Find the maximal window [i, j) that fits
    while (j < n) {
      const unitLen = getLength(chunkUnits[j].unit, lengthFunction)
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
    // Advance window
    if (chunkOverlap > 0 && j - i > 0) {
      i += Math.max(1, j - i - chunkOverlap)
    } else {
      i = j
    }
  }
  return chunks
}
