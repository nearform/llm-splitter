export interface SplitOptions {
  /** Maximum size of each chunk (default: 512). */
  chunkSize?: number
  /** Number of characters to overlap between chunks (default: 0). */
  chunkOverlap?: number
  /**
   * Optional function to split text into units.
   * If omitted, defaults to splitting character by character.
   */
  splitter?: (text: string) => string[]
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

export interface ChunkResult {
  text: string | string[]
  start: number
  end: number
}
