import type { SplitOptions, Chunk, ChunkUnit } from './types'
import {
  canFitAllUnits,
  chunkByCharacter,
  chunkByGreedySlidingWindow,
  getLength,
  getUnits
} from './utils'

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
        for (let i = 0; i < chunkUnits.length; i++) {
          const chunkUnit = chunkUnits[i]
          yield {
            chunk: chunkUnit.unit,
            startIndex: i,
            startPosition: chunkUnit.start,
            endIndex: i,
            endPosition: chunkUnit.end
          }
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
