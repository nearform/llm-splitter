import { describe, it } from "node:test";
import assert from "node:assert";
import { delimiterSplitter } from "../src/delimiter-splitter.js";
import { split } from "../src/split.js";

describe("delimiterSplitter", () => {
  describe("reported offsets", () => {
    it("reports a part that repeats inside the delimiter run", () => {
      // The `"."` is at 4; a verbatim search finds the one at 1 instead.
      assert.deepStrictEqual(delimiterSplitter("...")("a...."), [
        { text: "a", start: 0 },
        { text: ".", start: 4 },
      ]);
    });

    it("omits empty parts from consecutive delimiters", () => {
      assert.deepStrictEqual(delimiterSplitter("\n\n")("a\n\n\n\nb"), [
        { text: "a", start: 0 },
        { text: "b", start: 5 },
      ]);
    });

    it("returns the whole input when the delimiter is absent", () => {
      assert.deepStrictEqual(delimiterSplitter("|")("abc"), [
        { text: "abc", start: 0 },
      ]);
    });

    it("skips a leading delimiter", () => {
      assert.deepStrictEqual(delimiterSplitter("--")("--ab"), [
        { text: "ab", start: 2 },
      ]);
    });

    it("skips a trailing delimiter", () => {
      assert.deepStrictEqual(delimiterSplitter("--")("ab--"), [
        { text: "ab", start: 0 },
      ]);
    });

    it("advances by the full width of a multi-character delimiter", () => {
      assert.deepStrictEqual(delimiterSplitter(" | ")("x | y | z"), [
        { text: "x", start: 0 },
        { text: "y", start: 4 },
        { text: "z", start: 8 },
      ]);
    });

    it("returns nothing for an input that is only delimiters", () => {
      assert.deepStrictEqual(delimiterSplitter("ab")("ababab"), []);
    });

    it("returns nothing for empty input", () => {
      assert.deepStrictEqual(delimiterSplitter(",")(""), []);
    });
  });

  describe("validation", () => {
    it("rejects an empty delimiter, which would never advance", () => {
      assert.throws(() => delimiterSplitter(""), {
        name: "TypeError",
        message: "Delimiter must not be empty",
      });
    });

    it("rejects a non-string delimiter", () => {
      assert.throws(
        // @ts-expect-error a regex is not a delimiter
        () => delimiterSplitter(/,/),
        {
          name: "TypeError",
          message: "Delimiter must be a string. Received: object",
        },
      );
    });
  });

  describe("through split", () => {
    it("covers every code unit of a delimited source", () => {
      const input = "one, two,, three, ";
      const chunks = split(input, {
        chunkSize: 2,
        splitter: delimiterSplitter(", "),
      });

      assert.strictEqual(chunks[0].start, 0);
      assert.strictEqual(chunks[chunks.length - 1].end, input.length);
      for (let i = 0; i < chunks.length - 1; i++) {
        assert.strictEqual(chunks[i].end, chunks[i + 1].start);
      }
    });

    it("anchors past a delimiter run that repeats the next part", () => {
      const chunks = split("hi. .", {
        chunkSize: 1,
        splitter: delimiterSplitter(". "),
      });

      assert.deepStrictEqual(
        chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
        [
          ["hi. ", 0, 4],
          [".", 4, 5],
        ],
      );
    });
  });
});
