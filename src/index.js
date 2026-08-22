export { getChunk } from "./get-chunk.js";
export { split } from "./split.js";
export { delimiterSplitter } from "./delimiter-splitter.js";

/**
 * @template {string|string[]} [T=string|string[]]
 * @typedef {import('./split.js').Chunk<T>} Chunk
 */
/** @typedef {import('./split.js').SplitOptions} SplitOptions */
/** @typedef {import('./split.js').SplitterPart} SplitterPart */
