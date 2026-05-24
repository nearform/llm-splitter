/**
 * @typedef {object} Chunk
 * @property {string|string[]} text
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} SplitOptions
 * @property {number} [chunkSize]
 * @property {number} [chunkOverlap]
 * @property {(input: string) => string[]} [splitter]
 * @property {"character"|"paragraph"} [chunkStrategy]
 */

const CHUNK_STRATEGIES = new Set(["character", "paragraph"]);

/**
 * @param {{
 *   chunkSize: number
 *   chunkOverlap: number
 *   splitter: (input: string) => string[]
 *   chunkStrategy: string
 * }} opts
 */
const splitValidate = ({
  chunkSize,
  chunkOverlap,
  splitter,
  chunkStrategy,
}) => {
  if (!CHUNK_STRATEGIES.has(chunkStrategy))
    throw new Error(
      `Invalid chunk strategy. Must be one of: ${[...CHUNK_STRATEGIES].join(", ")}`,
    );

  if (typeof chunkSize !== "number" || !Number.isInteger(chunkSize))
    throw new Error("Chunk size must be a positive integer");

  if (chunkSize < 1) throw new Error("Chunk size must be at least 1");

  if (typeof chunkOverlap !== "number" || !Number.isInteger(chunkOverlap))
    throw new Error(
      `Chunk overlap must be a non-negative integer. Found: ${chunkOverlap}`,
    );

  if (chunkOverlap < 0) throw new Error("Chunk overlap must be at least 0");

  if (chunkOverlap >= chunkSize)
    throw new Error("Chunk overlap must be less than chunk size");

  if (typeof splitter !== "function")
    throw new Error("Splitter must be a function");
};

/**
 * Split text into chunks.
 *
 * @param {string|string[]} input - The input (string or array of strings) to split.
 * @param {SplitOptions} [options]
 * @returns {Chunk[]}
 */
export function split(
  input,
  {
    chunkSize = 512,
    chunkOverlap = 0,
    splitter = (text) => text.split(""),
    chunkStrategy = "character",
  } = {},
) {
  splitValidate({ chunkSize, chunkOverlap, splitter, chunkStrategy });
  void input;
  throw new Error("split() not yet implemented");
}
