/** @typedef {import('./split.js').SplitterPart} SplitterPart */

/**
 * Build a splitter that splits on `delimiter` and reports each part's exact
 * source offset, so `split()` positions those parts from knowledge rather than
 * inferring an offset from their text.
 *
 * Written as `indexOf` in a loop rather than `String.split`, because `split`
 * discards precisely the offsets this exists to report. That is also what
 * makes it right where the search is wrong: splitting `"a...."` on `"..."`
 * leaves a `"."` at offset 4, and a verbatim search for `"."` finds the one at
 * 1 first — inside the span the delimiter consumed.
 *
 * Empty parts are omitted, matching the `filter(Boolean)` idiom the README
 * already pairs with `String.split`.
 *
 * @param {string} delimiter
 * @returns {(input: string) => SplitterPart[]}
 */
export const delimiterSplitter = (delimiter) => {
  if (typeof delimiter !== "string") {
    throw new TypeError(
      `Delimiter must be a string. Received: ${typeof delimiter}`,
    );
  }

  // An empty delimiter matches at every position while consuming nothing, so
  // the scan below would never advance the cursor.
  if (delimiter.length === 0) {
    throw new TypeError("Delimiter must not be empty");
  }

  return (input) => {
    /** @type {SplitterPart[]} */
    const parts = [];
    let cursor = 0;
    let hit = input.indexOf(delimiter);

    while (hit !== -1) {
      if (hit > cursor) {
        parts.push({ text: input.slice(cursor, hit), start: cursor });
      }
      cursor = hit + delimiter.length;
      hit = input.indexOf(delimiter, cursor);
    }

    if (cursor < input.length) {
      parts.push({ text: input.slice(cursor), start: cursor });
    }

    return parts;
  };
};
