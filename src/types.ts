/**
 * Configuration options for text chunking operations.
 *
 * Controls the behavior of chunk size limits, overlap handling, tokenization,
 * and chunking strategies for both string and array inputs.
 */
export interface SplitOptions {
  /**
   * Maximum size of each chunk in tokens (default: 512).
   *
   * Determines the upper limit for chunk size based on the output of the splitter function.
   * For character-based splitting (default), this represents the maximum character count.
   * For custom tokenizers (e.g., tiktoken), this represents the actual token count.
   */
  chunkSize?: number

  /**
   * Number of tokens to overlap between consecutive chunks (default: 0).
   *
   * Creates overlapping content between chunks to maintain context across boundaries.
   * The overlap is calculated using the same splitter function as chunk sizing.
   * Useful for maintaining semantic continuity in vectorization scenarios.
   */
  chunkOverlap?: number

  /**
   * Function to split text into tokens for size calculation.
   *
   * If omitted, defaults to character-based splitting where each character is one token.
   * Custom splitters enable integration with various tokenizers:
   * - Word-based: `(text) => text.split(/\s+/)`
   * - Tiktoken: `(text) => encoding.encode(text).map(t => encoding.decode([t]))`
   * - Sentence-based: Custom regex-based splitting
   *
   * @param text - The text to tokenize
   * @returns Array of token strings
   */
  splitter?: (text: string) => string[]

  /**
   * Chunking strategy to use (default: character-based).
   *
   * - `'paragraph'`: Splits text by paragraphs (double newlines), with automatic
   *   sub-chunking of long paragraphs. Preserves semantic document structure.
   * - `undefined`: Character-based chunking with binary search optimization for
   *   precise token boundaries.
   */
  chunkStrategy?: 'paragraph'
}

/**
 * Represents a text unit (typically a paragraph) with position metadata.
 *
 * Used internally by paragraph chunking strategies to maintain precise
 * character position tracking while processing document structure.
 */
export interface ChunkUnit {
  /** The text content of the unit (e.g., a paragraph). */
  unit: string

  /** Starting character position in the original text. */
  start: number

  /** Ending character position in the original text. */
  end: number
}

/**
 * Result object containing chunked text content and position metadata.
 *
 * Returned by all chunking functions to provide both the chunked content
 * and precise positional information for retrieval and validation.
 */
export interface ChunkResult {
  /**
   * The chunked text content.
   *
   * - String for single text input (preserves original format)
   * - String array for array input (contains aggregated elements)
   *
   * For array inputs with aggregation, each chunk contains multiple
   * source elements combined to maximize chunk size utilization.
   */
  text: string | string[]

  /**
   * Starting character position in the original text.
   *
   * For string inputs, this is the character index where the chunk begins.
   * For array inputs, this is the cumulative character position across
   * all array elements, accounting for element boundaries.
   */
  start: number

  /**
   * Ending character position in the original text.
   *
   * For string inputs, this is the character index where the chunk ends.
   * For array inputs, this is the cumulative character position across
   * all array elements, accounting for element boundaries.
   */
  end: number
}
