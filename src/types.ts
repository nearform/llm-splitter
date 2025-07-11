export interface SplitOptions {
  /** Maximum size of each chunk in tokens (default: 512). */
  chunkSize?: number
  /** Number of tokens to overlap between chunks (default: 0). */
  chunkOverlap?: number
  /**
   * Function to split text into tokens for size calculation.
   * If omitted, defaults to character-based splitting.
   */
  splitter?: (text: string) => string[]
  /**
   * Chunking strategy to use (default: 'paragraph').
   * 'paragraph' - Splits text by paragraphs (double newlines), with automatic sub-chunking of long paragraphs.
   */
  chunkStrategy?: 'paragraph'
}

export interface ChunkUnit {
  /** The text content of the unit (e.g., a paragraph). */
  unit: string
  /** Starting character position in the original text. */
  start: number
  /** Ending character position in the original text. */
  end: number
}

export interface ChunkResult {
  /** The chunked text content. String for single text input, array for array input. */
  text: string | string[]
  /** Starting character position in the original text. */
  start: number
  /** Ending character position in the original text. */
  end: number
}
