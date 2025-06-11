/**
 * Options for the split function.
 */
export interface SplitOptions {
  /** Maximum size of each chunk (default: 512). */
  chunkSize?: number
  /** Number of characters to overlap between chunks (default: 0). */
  chunkOverlap?: number
  /**
   * Optional function to calculate the length of the text.
   * If omitted, defaults to the number of characters (text.length).
   */
  lengthFunction?: (text: string) => number
  /**
   * Optional chunking strategy: 'sentence' or 'paragraph'.
   * If set, overrides character-based chunking. Default: 'paragraph'.
   */
  chunkStrategy?: 'sentence' | 'paragraph'
}

export interface Chunk {
  chunk: string
  startIndex: number // index in the input array or unit array
  startPosition: number // character offset in the original string
  endIndex: number // index in the input array or unit array
  endPosition: number // character offset in the original string
}

interface ChunkUnit {
  unit: string
  start: number
  end: number
}

/**
 * Get the length of a text based on the provided length function or default to character count.
 * @param text - The input text.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @returns The length of the text.
 */
function getLength(
  text: string,
  lengthFunction?: (text: string) => number
): number {
  return lengthFunction ? lengthFunction(text) : text.length
}

/**
 * Get text units based on the specified strategy.
 * @param text - The input text to split into units.
 * @param strategy - The chunking strategy to use.
 * @returns An array of text units with their start and end positions.
 */
function getUnits(
  text: string,
  strategy: 'sentence' | 'paragraph'
): ChunkUnit[] {
  const units: ChunkUnit[] = []
  if (strategy === 'paragraph') {
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
  } else {
    const regex: RegExp = /[^.!?]+[.!?]+(?:\s+|$)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const unit: string = match[0].trim()
      if (unit) units.push({ unit, start: match.index, end: regex.lastIndex })
    }
  }
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
function canFitAllUnits(
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
 * Generator function to yield chunks of text based on character count.
 * Each chunk will overlap with the previous chunk by `chunkOverlap` characters (if provided).
 *
 * @param currentText - The text to chunk.
 * @param chunkSize - Maximum size of each chunk.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @param chunkOverlap - Number of characters to overlap between chunks.
 * @yields Chunk object containing the chunked string and its indices.
 */
function* chunkByCharacter(
  currentText: string,
  chunkSize: number,
  lengthFunction: ((text: string) => number) | undefined,
  chunkOverlap: number
) {
  let start = 0
  const textLen = currentText.length
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
    yield {
      chunk: currentText.slice(start, bestEnd),
      startIndex: start,
      startPosition: start,
      endIndex: bestEnd - 1,
      endPosition: bestEnd
    }
    if (bestEnd >= textLen) break
    if (chunkOverlap > 0 && bestEnd > start)
      start = Math.max(bestEnd - chunkOverlap, start + 1)
    else start = bestEnd
  }
}

/**
 * Generator function to yield chunks of text based on a greedy sliding window approach.
 * Each chunk will overlap with the previous chunk by `chunkOverlap` characters (if provided).
 *
 * @param chunkUnits - Array of chunk units (sentences or paragraphs) with their text and positions.
 * @param lengthFunction - Optional function to calculate the length of the text.
 * @param joinerLen - Length of the joiner string used to combine units.
 * @param chunkSize - Maximum size of each chunk.
 * @param joiner - String used to join units into a chunk.
 * @param chunkOverlap - Number of characters to overlap between chunks.
 * @yields Chunk object containing the chunked string and its indices.
 */
function* chunkByGreedySlidingWindow(
  chunkUnits: ChunkUnit[],
  lengthFunction: ((text: string) => number) | undefined,
  joinerLen: number,
  chunkSize: number,
  joiner: string,
  chunkOverlap: number
) {
  let i = 0
  const n = chunkUnits.length
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
      const chunkStr = chunkUnits.slice(i, j).map(u => u.unit).join(joiner)
      yield {
        chunk: chunkStr,
        startIndex: i,
        startPosition: chunkUnits[i].start,
        endIndex: j - 1,
        endPosition: chunkUnits[j - 1].end
      }
    }
    // Advance window
    if (chunkOverlap > 0 && j - i > 0) {
      i += Math.max(1, (j - i) - chunkOverlap)
    } else {
      i = j
    }
  }
}

/**
 * Split text or array of texts for LLM vectorization using a sliding window approach.
 * Each chunk will overlap with the previous chunk by `chunkOverlap` characters (if provided).
 *
 * @param input - A string or array of strings to split.
 * @param options - Options object.
 * @returns Array of chunked strings.
 */
export function split(
  text: string | string[],
  options: SplitOptions = {}
): Chunk[] {
  return [...iterateChunks(text, options)]
}

/**
 * Synchronous generator version of split. Yields each chunk object as produced.
 * @param text - A string or array of strings to split.
 * @param options - Options object.
 * @yields Chunk object for each chunk.
 */
export function* iterateChunks(
  text: string | string[],
  {
    chunkSize = 512,
    chunkOverlap = 0,
    lengthFunction,
    chunkStrategy
  }: SplitOptions = {}
): Generator<Chunk> {
  const texts: string[] = Array.isArray(text) ? text : [text]
  for (const currentText of texts)
    if (currentText.length === 0)
      // If the text is empty, yield an empty chunk
      yield {
        chunk: '',
        startIndex: 0,
        startPosition: 0,
        endIndex: 0,
        endPosition: 0
      }
    else if (chunkStrategy) {
      // Get chunk units (sentences or paragraphs) based on strategy
      const chunkUnits: ChunkUnit[] =
        Array.isArray(text) && text !== texts
          ? (text as string[]).map((u: string) => ({
              unit: u,
              start: 0,
              end: u.length
            }))
          : getUnits(currentText, chunkStrategy)
      // Choose joiner based on strategy
      const joiner: string = chunkStrategy === 'paragraph' ? '\n\n' : ' '
      // Length of joiner (for accurate chunk size calculation)
      const joinerLen: number = getLength(joiner, lengthFunction)
      // Check if all units fit within chunk size
      if (canFitAllUnits(chunkUnits, lengthFunction, chunkSize, joinerLen))
        // If all units fit, yield each as its own chunk
        for (const chunkUnit of chunkUnits)
          yield {
            chunk: chunkUnit.unit,
            startIndex: chunkUnits.indexOf(chunkUnit),
            startPosition: chunkUnit.start,
            endIndex: chunkUnits.indexOf(chunkUnit),
            endPosition: chunkUnit.end
          }
      else
        // If not all units fit, use greedy sliding window approach
        yield* chunkByGreedySlidingWindow(
          chunkUnits,
          lengthFunction,
          joinerLen,
          chunkSize,
          joiner,
          chunkOverlap
        )
    } else
      // Default character-based chunking
      yield* chunkByCharacter(
        currentText,
        chunkSize,
        lengthFunction,
        chunkOverlap
      )
}

/**
 * Returns the substring from the input text(s) between start and end character positions (character-based only).
 * @param text - A string or array of strings.
 * @param start - Optional start character position (inclusive, default 0).
 * @param end - Optional end character position (exclusive, default: end of input).
 * @returns The substring between start and end positions.
 */
export function getChunk(
  text: string | string[],
  start?: number,
  end?: number
): string {
  const input: string = Array.isArray(text) ? text.join('') : text
  const s: number = start ?? 0
  const e: number = end ?? input.length
  return input.slice(s, e)
}
