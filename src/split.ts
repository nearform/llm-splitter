import { getChunk } from './get-chunk.js'

export enum ChunkStrategy {
  character = 'character',
  paragraph = 'paragraph'
}

export interface Chunk {
  text: string | string[] | null
  start: number
  end: number
  isBoundary?: boolean
}

export interface SplitOptions {
  chunkSize?: number
  chunkOverlap?: number
  splitter?: (input: string) => string[]
  chunkStrategy?: keyof typeof ChunkStrategy
}

type BoundaryFunction = (inputs: string[]) => string[][]

// Boundary functions take an array of string input and then return an array of arrays.
// (Confusing!). The key part is that each sub-array is a group of parts that must *all* be
// included in the same chunk if another sub-array is in the chunk, or fill the chunk and split
// apart in subsequent chunks.
const BOUNDARIES: Record<ChunkStrategy, BoundaryFunction> = {
  [ChunkStrategy.character]: (inputs: string[]): string[][] => [inputs],
  [ChunkStrategy.paragraph]: (inputs: string[]): string[][] => {
    const groups: string[][] = []
    for (const input of inputs)
      for (const paragraph of input.split(/\n\n/)) groups.push([paragraph])
    return groups
  }
}

const CHUNK_STRATEGIES = new Set<ChunkStrategy>(
  Object.keys(BOUNDARIES) as ChunkStrategy[]
)

/**
 * Assert that the chunk strategy is valid.
 * @param {unknown} chunkStrategy The chunk strategy to validate.
 * @throws {Error} If the chunk strategy is invalid.
 */
function assertChunkStrategy(
  chunkStrategy: unknown
): asserts chunkStrategy is ChunkStrategy {
  if (!CHUNK_STRATEGIES.has(chunkStrategy as ChunkStrategy))
    throw new Error(
      `Invalid chunk strategy. Must be one of: ${[...CHUNK_STRATEGIES].join(', ')}`
    )
}

/**
 * Split text into parts of text (or null if the part is ignored) and their start and end indices.
 *
 * While this function takes an array of strings, the `start` and `end` indices are from the
 * perspective of the entire input array as a joined long single string.
 *
 * @param {string[]} inputs - The inputs to split.
 * @param {Function} splitter - The function to split the text.
 * @param {number} baseOffset - The base offset to add to the start and end positions.
 * @returns {Chunk[]}
 */
export function splitToParts(
  inputs: string[],
  splitter: (input: string) => string[],
  baseOffset: number = 0
): Chunk[] {
  const parts: Chunk[] = []
  let offset: number = 0

  for (const input of inputs) {
    let inputStart: number = 0
    const inputParts: string[] = splitter(input)

    for (const part of inputParts) {
      let partFound: boolean = false
      let partStart: number = inputStart

      // Validation
      if (typeof part !== 'string')
        throw new Error(
          `Splitter returned a non-string part: ${part} for input: ${input}`
        )

      // Ignore empty string.
      if (part.length === 0) continue

      // Catch up cursor.
      while (partStart < input.length) {
        // Found a match of the part in the input.
        if (input.startsWith(part, partStart)) {
          // Just capture the matched part...
          partFound = true
          parts.push({
            text: part,
            start: partStart + offset + baseOffset,
            end: partStart + part.length + offset + baseOffset
          })

          inputStart = partStart + part.length
          break
        }

        // No match found, move cursor forward.
        // Ignore and discard unmatched parts.
        partStart++
      }

      if (!partFound)
        throw new Error(
          `Splitter did not return any parts for input (${input.length}): "${input.slice(0, 20)}"... with part (${part.length}): "${part.slice(0, 20)}"...`
        )
    }

    // Update offset.
    // Ignore and discard unmatched parts.
    offset += input.length
  }

  return parts
}

// Little helpers
const splitValidate = ({
  chunkSize,
  chunkOverlap,
  splitter,
  chunkStrategy
}: {
  chunkSize: number
  chunkOverlap: number
  splitter: (input: string) => string[]
  chunkStrategy: string
}) => {
  assertChunkStrategy(chunkStrategy)

  if (typeof chunkSize !== 'number' || !Number.isInteger(chunkSize))
    throw new Error('Chunk size must be a positive integer')

  if (chunkSize < 1) throw new Error('Chunk size must be at least 1')

  if (typeof chunkOverlap !== 'number' || !Number.isInteger(chunkOverlap))
    throw new Error(
      `Chunk overlap must be a non-negative integer. Found: ${chunkOverlap}`
    )

  if (chunkOverlap < 0) throw new Error('Chunk overlap must be at least 0')

  if (chunkOverlap >= chunkSize)
    throw new Error('Chunk overlap must be less than chunk size')

  if (typeof splitter !== 'function')
    throw new Error('Splitter must be a function')
}

class ChunkParts {
  public parts: Chunk[] = []
  public lastEmittedPart: Chunk | null = null
  public lastBoundaryPart: Chunk | null = null

  constructor(
    public input: string | string[],
    public chunkOverlap: number
  ) {}

  get length(): number {
    return this.parts.length
  }

  push(part: Chunk): void {
    this.parts.push(part)
    if (part.isBoundary) this.lastBoundaryPart = part
  }

  hasUnEmittedParts(): boolean {
    // First chunk.
    if (this.lastEmittedPart === null) return this.parts.length > 0

    // Subsequent chunks.
    if (this.parts.length > 0) {
      // Check if have un-emitted parts past the end of last emitted part.
      const lastPart = this.parts[this.parts.length - 1]
      return lastPart.end > this.lastEmittedPart.end
    }

    // Otherwise, we have no un-emitted parts.
    return false
  }

  emit(): Chunk {
    // Sanity check.
    if (this.parts.length === 0) throw new Error('Chunk parts is empty')

    // Prepare chunk.
    const start: number = this.parts[0].start
    this.lastEmittedPart = this.parts[this.parts.length - 1]
    const end: number = this.lastEmittedPart.end
    const chunk: Chunk = {
      text: getChunk(this.input, start, end),
      start,
      end
    }

    // Reset state.
    // At this point, we seed the new parts array with the overlap, if any found.
    if (this.chunkOverlap > 0) {
      this.parts = this.parts.slice(-this.chunkOverlap)
    } else {
      this.parts = []
    }

    // Clear out last boundary. We consider a new chunk to have "no" previous boundary.
    this.lastBoundaryPart = null

    return chunk
  }
}

/**
 * Split text into chunks.
 *
 * ## Chunk Structure
 * Note that when splitting into tokens if an array is passed to input, the array item boundary is
 * *always* a token boundary.
 *
 * In the returned structure, `start` is the start of the first token in the chunk and `end` is
 * the end of the last token. In between there may be unmatched / discarded parts between tokens
 * (e.g. if you split on whitespace, there may be spaces between tokens). The `text` field of
 * the returned chunk will include all the text or array of texts from the start to the end,
 * inclusive of the unmatched parts.
 *
 * ## Chunk Strategy
 * The `chunkStrategy` option allows you to specify how the chunks are grouped.
 * - `character`: There is no grouping preference here. Fit as many whole tokens as possible into a chunk.
 * - `paragraph`: Group tokens by paragraphs. If a paragraph exceeds the chunk size, it will be split across multiple chunks.
 *
 * @param {string|string[]} input - The input (string or array of strings) to split.
 * @param {Object} options
 * @param {number} options.chunkSize - The max number of tokens (from splitter) of each chunk.
 * @param {number} options.chunkOverlap - The overlapping number of tokens (from splitter) to include from previous chunk.
 * @param {Function} options.splitter - The function to split the text.
 * @param {string} options.chunkStrategy - The strategy used to group tokens into chunks.
 * @returns {Array<{text: string | null, start: number, end: number}>}
 */
export function split(
  input: string | string[],
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter = text => text.split(''),
    chunkStrategy = ChunkStrategy.character
  }: SplitOptions = {}
) {
  // Validation
  splitValidate({ chunkSize, chunkOverlap, splitter, chunkStrategy })

  // Chunk handling.
  const chunks: Chunk[] = []
  const chunkParts = new ChunkParts(input, chunkOverlap)

  // Inputs.
  const inputAsArray: string[] = Array.isArray(input) ? input : [input]
  const inputAsString: string = inputAsArray.join('')
  const groups: string[][] = BOUNDARIES[chunkStrategy](inputAsArray)

  // Iteration.
  let baseOffset: number = -1
  for (const group of groups) {
    // Empty pre-processed group.
    if (group.length === 0) continue

    // Find the start of the first part in the group and update our offset.
    const firstPart: string = group[0]
    baseOffset = inputAsString.indexOf(firstPart, baseOffset + 1)
    if (baseOffset === -1)
      throw new Error(`Could not find start of group: ${group.slice(0, 20)}...`)

    // Split with parts plus our offset.
    const parts: Chunk[] = splitToParts(group, splitter, baseOffset)

    // Empty post-processed group.
    if (parts.length === 0) continue

    // Mark the **last** part as the boundary.
    parts[parts.length - 1].isBoundary = true

    // If the current chunk has a portion with a boundary, and we can't fit this entire group
    // in the current chunk, emit the existing chunk and then continue adding to a fresh chunk.
    if (
      chunkParts.hasUnEmittedParts() &&
      chunkParts.lastBoundaryPart !== null &&
      chunkParts.length + parts.length > chunkSize
    ) {
      chunks.push(chunkParts.emit())
    }

    // Should add parts to chunks. Start iterating.
    for (const part of parts) {
      // Add the part to the current chunk.
      chunkParts.push(part)

      // Sanity check.
      if (chunkParts.length > chunkSize)
        throw new Error(
          `Chunk size is ${chunkSize}, but chunkParts.length is ${chunkParts.length} -- ${JSON.stringify(chunkParts)}`
        )

      if (chunkParts.length === chunkSize) chunks.push(chunkParts.emit())
    }
  }

  // Handle last chunk.
  if (chunkParts.hasUnEmittedParts()) chunks.push(chunkParts.emit())

  return chunks
}
