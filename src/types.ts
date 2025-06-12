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
   * Optional chunking strategy: 'paragraph'.
   * If set, overrides character-based chunking. Default: 'paragraph'.
   */
  chunkStrategy?: 'paragraph'
}

export interface ChunkUnit {
  unit: string
  start: number
  end: number
}
