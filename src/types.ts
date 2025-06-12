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

export interface ChunkUnit {
  unit: string
  start: number
  end: number
}
