import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { performance } from "node:perf_hooks";
import tiktoken from "tiktoken";
import { split } from "../src/split.js";
import { getChunk } from "../src/get-chunk.js";

/** @typedef {import('../src/split.js').Chunk} Chunk */

// Helpers
/** @param {string} text */
const charSplitter = (text) => text.split("");
/** @param {string} text */
const whitespaceSplitter = (text) => text.split(/\s+/);

const td = new TextDecoder();
/** @param {string} text */
const tokenSplitter = (text) =>
  Array.from(tokenizer.encode(text)).map((token) =>
    td.decode(tokenizer.decode(new Uint32Array([token]))),
  );

// Tests
/** @type {import('tiktoken').Tiktoken} */
let tokenizer;
describe("split", () => {
  before(() => {
    tokenizer = tiktoken.encoding_for_model("text-embedding-ada-002");
  });

  after(() => {
    tokenizer.free();
  });

  describe("split", () => {
    describe("basics", () => {
      it("should split array with whitespace splitter and extra whitespace", () => {
        const input = [
          " hello world! ",
          "This is the split test string. Of words. ",
          " ",
        ];
        const result = split(input, {
          chunkSize: 5,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello world! ", "This is the "], start: 1, end: 26 },
          { text: ["split test string. Of words. ", " "], start: 26, end: 56 },
        ]);
      });

      // Base cases
      it("should handle empty string input", () => {
        const input = "";
        const result = split(input);
        assert.deepStrictEqual(result, []);
      });

      it("should handle empty array input", () => {
        /** @type {string[]} */
        const input = [];
        const result = split(input);
        assert.deepStrictEqual(result, []);
      });

      it("should handle array with empty strings", () => {
        const input = ["", "", ""];
        const result = split(input);
        assert.deepStrictEqual(result, []);
      });

      it("should handle single character with default splitter", () => {
        const input = "a";
        const result = split(input, { chunkSize: 1 });
        assert.deepStrictEqual(result, [{ text: "a", start: 0, end: 1 }]);
      });

      it("should handle single word with default splitter", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 3 });
        assert.deepStrictEqual(result, [
          { text: "hel", start: 0, end: 3 },
          { text: "lo", start: 3, end: 5 },
        ]);
      });

      // Parameter permutations
      it("should use default chunkSize when not specified", () => {
        const input = "hello world";
        const result = split(input);
        // Default chunkSize is 512, so all text should be in one chunk
        assert.deepStrictEqual(result, [
          { text: "hello world", start: 0, end: 11 },
        ]);
      });

      it("should use default splitter when not specified", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 1 });
        // Default splitter is char split
        assert.deepStrictEqual(result, [
          { text: "h", start: 0, end: 1 },
          { text: "e", start: 1, end: 2 },
          { text: "l", start: 2, end: 3 },
          { text: "l", start: 3, end: 4 },
          { text: "o", start: 4, end: 5 },
        ]);
      });

      it("skips zero-length parts and does not count them toward chunkSize", () => {
        const input = "a,,b";
        /** @param {string} text */
        const splitter = (text) => text.split(",");
        // Parts are ["a", "", "b"] — the empty part anchors nowhere, so both
        // real parts land in one chunk that spans the dropped commas.
        assert.deepStrictEqual(split(input, { chunkSize: 2, splitter }), [
          { text: "a,,b", start: 0, end: 4 },
        ]);
      });

      it("should handle chunkSize larger than input", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 10 });
        assert.deepStrictEqual(result, [{ text: "hello", start: 0, end: 5 }]);
      });

      it("should handle chunkSize equal to input length", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 5 });
        assert.deepStrictEqual(result, [{ text: "hello", start: 0, end: 5 }]);
      });

      it("should handle chunkSize smaller than input length", () => {
        const input = "hello world";
        const result = split(input, { chunkSize: 3 });
        assert.deepStrictEqual(result, [
          { text: "hel", start: 0, end: 3 },
          { text: "lo ", start: 3, end: 6 },
          { text: "wor", start: 6, end: 9 },
          { text: "ld", start: 9, end: 11 },
        ]);
      });

      // Different input types
      it("should handle string input with whitespace splitter", () => {
        const input = "hello world test";
        const result = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello world ", start: 0, end: 12 },
          { text: "test", start: 12, end: 16 },
        ]);
      });

      it("should handle array input with whitespace splitter", () => {
        const input = ["hello world", "test string"];
        const result = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello world"], start: 0, end: 11 },
          { text: ["test string"], start: 11, end: 22 },
        ]);
      });

      it("should handle array with single string", () => {
        const input = ["hello world"];
        const result = split(input, {
          chunkSize: 3,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello world"], start: 0, end: 11 },
        ]);
      });

      it("should handle array with multiple strings", () => {
        const input = ["hello", "world", "test"];
        const result = split(input, {
          chunkSize: 2,
          splitter: charSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["he"], start: 0, end: 2 },
          { text: ["ll"], start: 2, end: 4 },
          { text: ["o", "w"], start: 4, end: 6 },
          { text: ["or"], start: 6, end: 8 },
          { text: ["ld"], start: 8, end: 10 },
          { text: ["te"], start: 10, end: 12 },
          { text: ["st"], start: 12, end: 14 },
        ]);
      });

      // Edge cases
      it("should handle input with only whitespace", () => {
        const input = "   ";
        const result = split(input, {
          chunkSize: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, []);
      });

      it("should handle input with only whitespace in array", () => {
        const input = ["   ", "  "];
        const result = split(input, {
          chunkSize: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, []);
      });

      it("should handle chunkSize of 1", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 1 });
        assert.deepStrictEqual(result, [
          { text: "h", start: 0, end: 1 },
          { text: "e", start: 1, end: 2 },
          { text: "l", start: 2, end: 3 },
          { text: "l", start: 3, end: 4 },
          { text: "o", start: 4, end: 5 },
        ]);
      });

      // Argument validation — matrix.
      /** @type {Array<{ name: string, opts: any, msg: string }>} */
      const invalidOptionCases = [
        {
          name: "chunkSize 0",
          opts: { chunkSize: 0 },
          msg: "Chunk size must be at least 1",
        },
        {
          name: "negative chunkSize",
          opts: { chunkSize: -1 },
          msg: "Chunk size must be at least 1",
        },
        {
          name: "non-integer chunkSize",
          opts: { chunkSize: 1.5 },
          msg: "Chunk size must be a positive integer. Found: 1.5",
        },
        {
          name: "non-number chunkSize (string)",
          opts: { chunkSize: "invalid" },
          msg: "Chunk size must be a positive integer. Found: invalid",
        },
        {
          name: "negative chunkOverlap",
          opts: { chunkSize: 5, chunkOverlap: -1 },
          msg: "Chunk overlap must be at least 0",
        },
        {
          name: "non-integer chunkOverlap",
          opts: { chunkSize: 5, chunkOverlap: 1.5 },
          msg: "Chunk overlap must be a non-negative integer. Found: 1.5",
        },
        {
          name: "non-number chunkOverlap (string)",
          opts: { chunkSize: 5, chunkOverlap: "invalid" },
          msg: "Chunk overlap must be a non-negative integer. Found: invalid",
        },
        {
          name: "chunkOverlap equal to chunkSize",
          opts: { chunkSize: 5, chunkOverlap: 5 },
          msg: "Chunk overlap must be less than chunk size",
        },
        {
          name: "chunkOverlap greater than chunkSize",
          opts: { chunkSize: 3, chunkOverlap: 5 },
          msg: "Chunk overlap must be less than chunk size",
        },
      ];

      for (const { name, opts, msg } of invalidOptionCases) {
        it(`rejects ${name}`, () => {
          assert.throws(() => split("hello", opts), {
            name: "Error",
            message: msg,
          });
        });
      }

      // Token splitter tests
      it("should handle string input with token splitter", () => {
        const input = "hello world";
        const result = split(input, {
          chunkSize: 2,
          splitter: tokenSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello world", start: 0, end: 11 },
        ]);
      });

      it("should handle array input with token splitter", () => {
        const input = [
          "hello",
          "world",
          "bar baz buz",
          "what? why? howdymachina",
        ];
        const result = split(input, {
          chunkSize: 2,
          splitter: tokenSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello", "world"], start: 0, end: 10 },
          { text: ["bar baz"], start: 10, end: 17 },
          { text: [" buz", "what"], start: 17, end: 25 },
          { text: ["? why"], start: 25, end: 30 },
          { text: ["? how"], start: 30, end: 35 },
          { text: ["dym"], start: 35, end: 38 },
          { text: ["achina"], start: 38, end: 44 },
        ]);
      });

      // Complex scenarios
      it("should handle mixed content with whitespace splitter", () => {
        const input = "hello   world!  test";
        const result = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello   world!  ", start: 0, end: 16 },
          { text: "test", start: 16, end: 20 },
        ]);
      });

      it("should handle array with mixed content", () => {
        const input = ["hello", "   world!", "test"];
        const result = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello", "   world!"], start: 0, end: 14 },
          { text: ["test"], start: 14, end: 18 },
        ]);
      });

      it("should handle very large chunkSize", () => {
        const input = "hello world test string";
        const result = split(input, { chunkSize: 1000 });
        assert.deepStrictEqual(result, [
          { text: "hello world test string", start: 0, end: 23 },
        ]);
      });

      it("should handle array boundary as token boundary", () => {
        const input = ["hello", "world"];
        const result = split(input, {
          chunkSize: 3,
          splitter: charSplitter,
        });
        // Should respect array boundaries
        assert.deepStrictEqual(result, [
          { text: ["hel"], start: 0, end: 3 },
          { text: ["lo", "w"], start: 3, end: 6 },
          { text: ["orl"], start: 6, end: 9 },
          { text: ["d"], start: 9, end: 10 },
        ]);
      });
    });

    describe("chunkOverlap", () => {
      // Basic overlap tests with char splitter
      it("should handle chunkOverlap of 1 with char splitter", () => {
        const input = "hello world";
        const result = split(input, { chunkSize: 3, chunkOverlap: 1 });
        assert.deepStrictEqual(result, [
          { text: "hel", start: 0, end: 3 },
          { text: "llo", start: 2, end: 5 },
          { text: "o w", start: 4, end: 7 },
          { text: "wor", start: 6, end: 9 },
          { text: "rld", start: 8, end: 11 },
        ]);
      });

      it("should handle chunkOverlap of 2 with char splitter", () => {
        const input = "hello world";
        const result = split(input, { chunkSize: 4, chunkOverlap: 2 });
        assert.deepStrictEqual(result, [
          { text: "hell", start: 0, end: 4 },
          { text: "llo ", start: 2, end: 6 },
          { text: "o wo", start: 4, end: 8 },
          { text: "worl", start: 6, end: 10 },
          { text: "rld", start: 8, end: 11 },
        ]);
      });

      it("should handle chunkOverlap equal to chunkSize - 1", () => {
        const input = "hello world";
        const result = split(input, { chunkSize: 3, chunkOverlap: 2 });
        assert.deepStrictEqual(result, [
          { text: "hel", start: 0, end: 3 },
          { text: "ell", start: 1, end: 4 },
          { text: "llo", start: 2, end: 5 },
          { text: "lo ", start: 3, end: 6 },
          { text: "o w", start: 4, end: 7 },
          { text: " wo", start: 5, end: 8 },
          { text: "wor", start: 6, end: 9 },
          { text: "orl", start: 7, end: 10 },
          { text: "rld", start: 8, end: 11 },
        ]);
      });

      // Overlap with whitespace splitter
      it("should handle chunkOverlap with whitespace splitter", () => {
        const input = "hello world test string";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello world", start: 0, end: 11 },
          { text: "world test", start: 6, end: 16 },
          { text: "test string", start: 12, end: 23 },
        ]);
      });

      it("should handle chunkOverlap with whitespace splitter and multiple spaces", () => {
        const input = "hello   world  test";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello   world", start: 0, end: 13 },
          { text: "world  test", start: 8, end: 19 },
        ]);
      });

      // Overlap with array inputs
      it("should handle chunkOverlap with array input and char splitter", () => {
        const input = ["hello", "world"];
        const result = split(input, { chunkSize: 3, chunkOverlap: 1 });
        assert.deepStrictEqual(result, [
          { text: ["hel"], start: 0, end: 3 },
          { text: ["llo"], start: 2, end: 5 },
          { text: ["o", "wo"], start: 4, end: 7 },
          { text: ["orl"], start: 6, end: 9 },
          { text: ["ld"], start: 8, end: 10 },
        ]);
      });

      it("should handle chunkOverlap with array input and whitespace splitter", () => {
        const input = ["hello world", "test string"];
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello world"], start: 0, end: 11 },
          { text: ["world", "test"], start: 6, end: 15 },
          { text: ["test string"], start: 11, end: 22 },
        ]);
      });

      // Edge cases for overlap
      it("should handle chunkOverlap of 0 (default behavior)", () => {
        const input = "hello world";
        const result = split(input, { chunkSize: 3, chunkOverlap: 0 });
        assert.deepStrictEqual(result, [
          { text: "hel", start: 0, end: 3 },
          { text: "lo ", start: 3, end: 6 },
          { text: "wor", start: 6, end: 9 },
          { text: "ld", start: 9, end: 11 },
        ]);
      });

      it("should handle chunkOverlap with input smaller than chunkSize", () => {
        const input = "hi";
        const result = split(input, { chunkSize: 5, chunkOverlap: 2 });
        assert.deepStrictEqual(result, [{ text: "hi", start: 0, end: 2 }]);
      });

      it("should handle chunkOverlap with input equal to chunkSize", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 5, chunkOverlap: 2 });
        assert.deepStrictEqual(result, [{ text: "hello", start: 0, end: 5 }]);
      });

      it("should handle chunkOverlap with single character input", () => {
        const input = "a";
        const result = split(input, { chunkSize: 3, chunkOverlap: 1 });
        assert.deepStrictEqual(result, [{ text: "a", start: 0, end: 1 }]);
      });

      // Complex overlap scenarios
      it("should handle large chunkOverlap with small chunkSize", () => {
        const input = "abcdefghij";
        const result = split(input, { chunkSize: 3, chunkOverlap: 2 });
        assert.deepStrictEqual(result, [
          { text: "abc", start: 0, end: 3 },
          { text: "bcd", start: 1, end: 4 },
          { text: "cde", start: 2, end: 5 },
          { text: "def", start: 3, end: 6 },
          { text: "efg", start: 4, end: 7 },
          { text: "fgh", start: 5, end: 8 },
          { text: "ghi", start: 6, end: 9 },
          { text: "hij", start: 7, end: 10 },
        ]);
      });

      it("should handle chunkOverlap with whitespace-only input", () => {
        const input = "   ";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, []);
      });

      it("should handle chunkOverlap with array containing empty strings", () => {
        const input = ["", "hello", ""];
        const result = split(input, { chunkSize: 3, chunkOverlap: 1 });
        assert.deepStrictEqual(result, [
          { text: ["hel"], start: 0, end: 3 },
          { text: ["llo"], start: 2, end: 5 },
        ]);
      });

      // Token splitter overlap tests
      it("should handle chunkOverlap with token splitter", () => {
        const input = "hello world test";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: tokenSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello world", start: 0, end: 11 },
          { text: " world test", start: 5, end: 16 },
        ]);
      });

      it("should handle chunkOverlap with token splitter and array input", () => {
        const input = ["hello", "world"];
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: tokenSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello", "world"], start: 0, end: 10 },
        ]);
      });

      // Boundary conditions
      it("should handle chunkOverlap with chunkSize of 1", () => {
        const input = "hello";
        const result = split(input, { chunkSize: 1, chunkOverlap: 0 });
        assert.deepStrictEqual(result, [
          { text: "h", start: 0, end: 1 },
          { text: "e", start: 1, end: 2 },
          { text: "l", start: 2, end: 3 },
          { text: "l", start: 3, end: 4 },
          { text: "o", start: 4, end: 5 },
        ]);
      });

      it("should handle chunkOverlap with very large chunkSize", () => {
        const input = "hello world";
        const result = split(input, {
          chunkSize: 100,
          chunkOverlap: 10,
        });
        assert.deepStrictEqual(result, [
          { text: "hello world", start: 0, end: 11 },
        ]);
      });

      // Mixed content scenarios
      it("should handle chunkOverlap with mixed content and whitespace splitter", () => {
        const input = "hello   world!  test";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello   world!", start: 0, end: 14 },
          { text: "world!  test", start: 8, end: 20 },
        ]);
      });

      it("should handle chunkOverlap with array containing mixed content", () => {
        const input = ["hello", "   world!", "test"];
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: ["hello", "   world!"], start: 0, end: 14 },
          { text: ["world!", "test"], start: 8, end: 18 },
        ]);
      });

      // Overlap behavior verification
      it("overlap=2 carries last 2 chars of each chunk to next, with forward progress", () => {
        const input = "abcdefghijklmnop";
        const result = split(input, { chunkSize: 4, chunkOverlap: 2 });
        assert.ok(result.length > 1, "expected multiple chunks");
        for (let i = 1; i < result.length; i++) {
          const prevChunk = result[i - 1];
          const currChunk = result[i];
          const prevText = /** @type {string} */ (prevChunk.text);
          const currText = /** @type {string} */ (currChunk.text);

          assert.strictEqual(
            currText.substring(0, 2),
            prevText.substring(prevText.length - 2),
            `Chunk ${i} should start with last 2 chars of chunk ${i - 1}`,
          );
          // Forward progress: each chunk must start strictly after the previous
          // (otherwise we'd loop) and must have non-empty span.
          assert.ok(
            currChunk.start > prevChunk.start,
            `Chunk ${i} start (${currChunk.start}) must exceed chunk ${i - 1} start (${prevChunk.start})`,
          );
          assert.ok(
            currChunk.end > currChunk.start,
            `Chunk ${i} must have positive width`,
          );
        }
      });

      it("should handle chunkOverlap with unicode characters", () => {
        const input = "héllö wörld";
        const result = split(input, { chunkSize: 3, chunkOverlap: 1 });
        assert.deepStrictEqual(result, [
          { text: "hél", start: 0, end: 3 },
          { text: "llö", start: 2, end: 5 },
          { text: "ö w", start: 4, end: 7 },
          { text: "wör", start: 6, end: 9 },
          { text: "rld", start: 8, end: 11 },
        ]);
      });

      // Stress tests
      it("chunkSize=2 chunkOverlap=1 produces overlapping 2-char chunks across the full input", () => {
        const input = "abcdefghijklmnopqrstuvwxyz";
        const result = split(input, { chunkSize: 2, chunkOverlap: 1 });
        // Should have many overlapping chunks
        assert(result.length > 10);
        // Each chunk should have exactly 2 characters
        for (const chunk of result) {
          assert.strictEqual(/** @type {string} */ (chunk.text).length, 2);
        }
      });

      it("should handle chunkOverlap with whitespace splitter and complex spacing", () => {
        const input = "  hello   world  test  string  ";
        const result = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        assert.deepStrictEqual(result, [
          { text: "hello   world", start: 2, end: 15 },
          { text: "world  test", start: 10, end: 21 },
          { text: "test  string  ", start: 17, end: 31 },
        ]);
      });
    });

    describe("chunkStrategy", () => {
      describe("validation", () => {
        it("should throw error for invalid chunkStrategy", () => {
          const input = "hello world";
          assert.throws(
            () => {
              // @ts-expect-error test
              split(input, { chunkSize: 5, chunkStrategy: "invalid" });
            },
            {
              name: "Error",
              message:
                "Invalid chunk strategy. Must be one of: character, paragraph",
            },
          );
        });

        it("should accept character chunkStrategy", () => {
          const input = "hello world";
          const result = split(input, {
            chunkSize: 3,
            chunkStrategy: "character",
          });
          assert.deepStrictEqual(result, [
            { text: "hel", start: 0, end: 3 },
            { text: "lo ", start: 3, end: 6 },
            { text: "wor", start: 6, end: 9 },
            { text: "ld", start: 9, end: 11 },
          ]);
        });

        it("should accept paragraph chunkStrategy", () => {
          const input = "hello\n\nworld";
          const result = split(input, {
            chunkSize: 3,
            chunkStrategy: "paragraph",
          });
          assert.deepStrictEqual(result, [
            { text: "hel", start: 0, end: 3 },
            { text: "lo\n\n", start: 3, end: 7 },
            { text: "wor", start: 7, end: 10 },
            { text: "ld", start: 10, end: 12 },
          ]);
        });
      });

      // Character strategy tests (default behavior)
      describe("character strategy", () => {
        it("should behave like default behavior when chunkStrategy is character", () => {
          const input = "hello world";
          const result1 = split(input, { chunkSize: 3 });
          const result2 = split(input, {
            chunkSize: 3,
            chunkStrategy: "character",
          });
          assert.deepStrictEqual(result1, result2);
        });

        it("should handle character strategy with whitespace splitter", () => {
          const input = "hello world test";
          const result = split(input, {
            chunkSize: 2,
            chunkStrategy: "character",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello world ", start: 0, end: 12 },
            { text: "test", start: 12, end: 16 },
          ]);
        });

        it("should handle character strategy with array input", () => {
          const input = ["hello", "world"];
          const result = split(input, {
            chunkSize: 3,
            chunkStrategy: "character",
            splitter: charSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: ["hel"], start: 0, end: 3 },
            { text: ["lo", "w"], start: 3, end: 6 },
            { text: ["orl"], start: 6, end: 9 },
            { text: ["d"], start: 9, end: 10 },
          ]);
        });

        it("should handle character strategy with chunkOverlap", () => {
          const input = "hello world";
          const result = split(input, {
            chunkSize: 3,
            chunkOverlap: 1,
            chunkStrategy: "character",
          });
          assert.deepStrictEqual(result, [
            { text: "hel", start: 0, end: 3 },
            { text: "llo", start: 2, end: 5 },
            { text: "o w", start: 4, end: 7 },
            { text: "wor", start: 6, end: 9 },
            { text: "rld", start: 8, end: 11 },
          ]);
        });
      });

      // Paragraph strategy tests
      describe("paragraph strategy", () => {
        it("should group tokens by paragraphs", () => {
          const input = "hello\n\nworld\n\ntest";
          const result = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\n", start: 0, end: 7 },
            { text: "world\n\n", start: 7, end: 14 },
            { text: "test", start: 14, end: 18 },
          ]);
        });

        it("should handle single paragraph that fits in chunk", () => {
          const input = "hello world";
          const result = split(input, {
            chunkSize: 5,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello world", start: 0, end: 11 },
          ]);
        });

        it("should handle paragraph that exceeds chunk size", () => {
          const input = "hello world test string";
          const result = split(input, {
            chunkSize: 2,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          // Should split across multiple chunks since paragraph is too large
          assert.deepStrictEqual(result, [
            { text: "hello world ", start: 0, end: 12 },
            { text: "test string", start: 12, end: 23 },
          ]);
        });

        it("should handle multiple paragraphs with mixed sizes", () => {
          const input =
            "short\n\nvery long paragraph with many words\n\nanother short";
          const result = split(input, {
            chunkSize: 3,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "short\n\n", start: 0, end: 7 },
            { text: "very long paragraph ", start: 7, end: 27 },
            { text: "with many words\n\n", start: 27, end: 44 },
            { text: "another short", start: 44, end: 57 },
          ]);
        });

        it("should handle empty paragraphs", () => {
          const input = "hello\n\n\n\nworld";
          const result = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\n\n\n", start: 0, end: 9 },
            { text: "world", start: 9, end: 14 },
          ]);
        });

        it("should handle paragraphs with only whitespace", () => {
          const input = "hello\n\n   \n\nworld";
          const result = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\n   \n\n", start: 0, end: 12 },
            { text: "world", start: 12, end: 17 },
          ]);
        });

        it("should handle array input with paragraph strategy", () => {
          const input = ["hello\n\nworld", "test\n\nstring"];
          const result = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: ["hello\n\n"], start: 0, end: 7 },
            { text: ["world"], start: 7, end: 12 },
            { text: ["test\n\n"], start: 12, end: 18 },
            { text: ["string"], start: 18, end: 24 },
          ]);
        });

        it("should handle paragraph strategy with char splitter", () => {
          const input = "hello\n\nworld";
          const result = split(input, {
            chunkSize: 3,
            chunkStrategy: "paragraph",
            splitter: charSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hel", start: 0, end: 3 },
            { text: "lo\n\n", start: 3, end: 7 },
            { text: "wor", start: 7, end: 10 },
            { text: "ld", start: 10, end: 12 },
          ]);
        });

        it("should handle paragraph strategy with token splitter", () => {
          const input = "hello\n\nworld";
          const result = split(input, {
            chunkSize: 2,
            chunkStrategy: "paragraph",
            splitter: tokenSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\nworld", start: 0, end: 12 },
          ]);
        });

        it("should handle paragraph strategy with chunkOverlap", () => {
          const input = "hello\n\nworld\n\ntest";
          const result = split(input, {
            chunkSize: 2,
            chunkOverlap: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\nworld", start: 0, end: 12 },
            { text: "world\n\ntest", start: 7, end: 18 },
          ]);
        });

        it("overlap parts do not count as a paragraph boundary, so they can split a fitting paragraph", () => {
          // Second paragraph has 9 parts and would fit whole in an empty
          // chunkSize=10 chunk, but the 2 carried-over overlap parts leave
          // room for only 8 of them.
          const first = Array.from({ length: 10 }, (_, i) => `a${i}`).join(" ");
          const second = Array.from({ length: 9 }, (_, i) => `b${i}`).join(" ");
          const input = `${first}\n\n${second}`;
          /** @param {number} chunkOverlap */
          const texts = (chunkOverlap) =>
            split(input, {
              chunkSize: 10,
              chunkOverlap,
              chunkStrategy: "paragraph",
              splitter: whitespaceSplitter,
            }).map((chunk) => chunk.text);

          assert.deepStrictEqual(texts(2), [
            "a0 a1 a2 a3 a4 a5 a6 a7 a8 a9",
            "a8 a9\n\nb0 b1 b2 b3 b4 b5 b6 b7",
            "b6 b7 b8",
          ]);
          assert.deepStrictEqual(texts(0), [
            "a0 a1 a2 a3 a4 a5 a6 a7 a8 a9\n\n",
            "b0 b1 b2 b3 b4 b5 b6 b7 b8",
          ]);
        });

        it("should handle paragraph strategy with mixed content in array", () => {
          const input = ["hello\n\nworld", "test", "string\n\nend"];
          const result = split(input, {
            chunkSize: 2,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: ["hello\n\nworld"], start: 0, end: 12 },
            { text: ["test", "string\n\n"], start: 12, end: 24 },
            { text: ["end"], start: 24, end: 27 },
          ]);
        });

        it("paragraph strategy produces fewer-or-equal chunks than character for the same input", () => {
          const input = "hello\n\nworld test";
          const charResult = split(input, {
            chunkSize: 3,
            chunkStrategy: "character",
            splitter: whitespaceSplitter,
          });
          const paragraphResult = split(input, {
            chunkSize: 3,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          // Character strategy should split more aggressively
          assert(charResult.length >= paragraphResult.length);
          // Paragraph strategy should respect paragraph boundaries
          assert.deepStrictEqual(paragraphResult, [
            { text: "hello\n\nworld test", start: 0, end: 17 },
          ]);
        });

        it("should handle paragraph strategy with chunkSize larger than any paragraph", () => {
          const input = "hello\n\nworld\n\ntest";
          const result = split(input, {
            chunkSize: 100,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: "hello\n\nworld\n\ntest", start: 0, end: 18 },
          ]);
        });

        it("handles paragraphs within array items", () => {
          const input = [
            " hello\nbig world! ",
            "This is the split test string in a very long long string.\n\nOf words. \n\nHi there",
            "Another.",
            " ",
          ];

          const result = split(input, {
            chunkSize: 10,
            chunkOverlap: 2,
            splitter: whitespaceSplitter,
            chunkStrategy: "paragraph",
          });
          assert.deepStrictEqual(result, [
            { text: ["hello\nbig world!"], start: 1, end: 17 },
            {
              text: ["big world! ", "This is the split test string in a"],
              start: 7,
              end: 52,
            },
            {
              text: ["in a very long long string.\n\nOf words. \n\nHi there"],
              start: 48,
              end: 97,
            },
            { text: ["Hi there", "Another.", " "], start: 89, end: 106 },
          ]);
        });
      });

      // Edge cases and error conditions
      describe("edge cases", () => {
        it("should handle empty input with both strategies", () => {
          const emptyInput = "";
          const charResult = split(emptyInput, {
            chunkStrategy: "character",
          });
          const paragraphResult = split(emptyInput, {
            chunkStrategy: "paragraph",
          });
          assert.deepStrictEqual(charResult, []);
          assert.deepStrictEqual(paragraphResult, []);
        });

        it("should handle array with empty strings with both strategies", () => {
          const emptyArray = ["", "", ""];
          const charResult = split(emptyArray, {
            chunkStrategy: "character",
          });
          const paragraphResult = split(emptyArray, {
            chunkStrategy: "paragraph",
          });
          assert.deepStrictEqual(charResult, []);
          assert.deepStrictEqual(paragraphResult, []);
        });

        it("should handle single character with both strategies", () => {
          const input = "a";
          const charResult = split(input, {
            chunkSize: 1,
            chunkStrategy: "character",
          });
          const paragraphResult = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
          });
          assert.deepStrictEqual(charResult, paragraphResult);
          assert.deepStrictEqual(charResult, [{ text: "a", start: 0, end: 1 }]);
        });

        it("should handle whitespace-only input with both strategies", () => {
          const input = "   ";
          const charResult = split(input, {
            chunkSize: 1,
            chunkStrategy: "character",
            splitter: whitespaceSplitter,
          });
          const paragraphResult = split(input, {
            chunkSize: 1,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(charResult, []);
          assert.deepStrictEqual(paragraphResult, []);
        });

        it("should handle array with unicode characters with token splitter", async () => {
          const input = ["he¦¦o", "world", "👋🏻", " ¦"];
          const result = split(input, {
            chunkSize: 2,
            splitter: tokenSplitter,
          });

          // NOTE: Token split results:
          // [
          //   [ 'he', '¦', '¦', 'o' ],           // `'he¦¦o'`
          //   [ 'world' ],                       // `'world'`
          //   [ '�', '�', '�', '�', '�', '�' ],  // `'👋🏻'`
          //   [ ' �', '�' ]                      // `' ¦'`
          // ]

          assert.deepStrictEqual(result, [
            // First two tokens: 'he', '¦'
            { text: ["he¦"], start: 0, end: 3 },
            // Second two tokens: '¦', 'o'
            { text: ["¦o"], start: 3, end: 5 },
            // 'world' (full match) plus the ' �' token which anchors at the
            // space and claims its splitPart.length=2 of source — covering
            // the trailing '¦'. The 5 all-replacement tokens for '👋🏻' have
            // no anchor grapheme and are silently dropped, but the source
            // bytes are still preserved in chunk.text via getChunk.
            { text: ["world", "👋🏻", " ¦"], start: 5, end: 16 },
          ]);
        });

        it("should handle string with unicode characters with token splitter", async () => {
          const input = "hello w👋🏻rld extra";
          const result = split(input, {
            chunkSize: 2,
            splitter: tokenSplitter,
          });

          assert.deepStrictEqual(result, [
            { text: "hello w👋🏻", start: 0, end: 11 },
            { text: "rld", start: 11, end: 14 },
            { text: " extra", start: 14, end: 20 },
          ]);
        });

        it("should handle string with unicode characters with whitespace splitter", async () => {
          const input = "hello w👋🏻rld extra";
          const result = split(input, {
            chunkSize: 2,
            splitter: whitespaceSplitter,
          });

          assert.deepStrictEqual(result, [
            { text: "hello w👋🏻rld ", start: 0, end: 15 },
            { text: "extra", start: 15, end: 20 },
          ]);
        });

        it("should handle array with unicode characters with whitespace splitter", async () => {
          const input = [
            "hi👋 w🌍rld wow😃",
            "🚀",
            "more 🚀 text here",
            "yay!🎉",
          ];
          const result = split(input, {
            chunkOverlap: 2,
            chunkSize: 5,
            splitter: whitespaceSplitter,
          });

          // The new grapheme-based anchoring correctly locates the inner '🚀'
          // token in "more 🚀 text here". The previous algorithm silently
          // dropped tokens that were entirely surrogate-pair code units
          // (charCode > 255), producing 8 anchored tokens instead of 9. With
          // 9 real tokens at chunkSize=5/chunkOverlap=2 we get 3 chunks, not 2.
          assert.deepStrictEqual(result, [
            { text: ["hi👋 w🌍rld wow😃", "🚀", "more"], start: 0, end: 23 },
            { text: ["🚀", "more 🚀 text here"], start: 17, end: 36 },
            { text: ["text here", "yay!🎉"], start: 27, end: 42 },
          ]);
        });

        it("should handle multibyte arrays with token splitter", async () => {
          const input = [
            "hello 🌍",
            "café naïve façade",
            "こんにちは world",
            "emoji: 😀😃😄😁",
            "русский текст mixed",
            "中文字符 and english",
            "Español: año, niño, jalapeño",
            "français: élève, déjà vu",
            "Grüße, München! Straße",
            "Zürich — Genève",
            "crème brûlée",
            "smörgåsbord",
            "piñata 🎉 fiesta",
            "I ❤️ TypeScript",
            "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𝔣𝔬𝔫𝔱𝔰",
            "Math: ∑ ∫ √ ∞ ≈ ≠ ≤ ≥",
            "Arabic: مرحبا بالعالم",
            "Hebrew: שלום עולם",
            "Hindi: नमस्ते दुनिया",
            "Thai: สวัสดีโลก",
          ];
          const chunks = split(input, {
            chunkSize: 2,
            chunkStrategy: "paragraph",
            splitter: tokenSplitter,
          });

          assert.ok(chunks.length > 0, "expected at least one chunk");
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // chunk.text matches positions
            const retrievedText = getChunk(input, chunk.start, chunk.end);
            assert.deepStrictEqual(chunk.text, retrievedText);
            // positive width
            assert.ok(
              chunk.end > chunk.start,
              `Chunk ${i} must have positive width`,
            );
            // monotonic ordering (no overlap=0 means no backward jumps)
            if (i > 0) {
              assert.ok(
                chunk.start >= chunks[i - 1].start,
                `Chunk ${i} start (${chunk.start}) must not precede chunk ${i - 1} start (${chunks[i - 1].start})`,
              );
            }
          }
        });

        it("throws if splitter returns a part not found in multibyte input", () => {
          const input = "h👋🏻llo w👋🏻rld extra";
          assert.throws(
            () => {
              split(input, {
                chunkSize: 2,
                splitter: (text) => text.toUpperCase().split(/\s+/),
              });
            },
            {
              message:
                'Splitter returned a part that could not be located in input (23): "h👋🏻llo w👋🏻rld ex"... with part (8): "H👋🏻LLO"...',
            },
          );
        });
      });
    });

    // Paragraph mode trims leading/trailing whitespace from each paragraph
    // before anchoring. Trimmed bytes are absorbed by the forward-extension
    // pass, or left uncovered if they precede chunks[0].start.
    describe("paragraph trim", () => {
      it("leading whitespace in a paragraph is stripped from anchored parts (char splitter)", () => {
        const input = "  hello\n\nworld";
        const result = split(input, {
          chunkSize: 5,
          chunkStrategy: "paragraph",
          splitter: charSplitter,
        });
        // Untrimmed, chunks[0] would anchor the two leading spaces and start
        // at position 0. Trimmed, chunks[0].start === 2 (where 'h' lives) and
        // the leading "  " is uncovered. The trailing "\n\n" is absorbed
        // forward into chunks[0] by the extension pass.
        assert.deepStrictEqual(result, [
          { text: "hello\n\n", start: 2, end: 9 },
          { text: "world", start: 9, end: 14 },
        ]);
      });

      it("trailing whitespace in a paragraph is stripped but absorbed by forward extension", () => {
        const input = "hello   \n\nworld";
        const result = split(input, {
          chunkSize: 5,
          chunkStrategy: "paragraph",
          splitter: charSplitter,
        });
        // chunks[0] anchors only "hello"; trailing "   " is unanchored. The
        // extension pass then pushes chunks[0].end forward to chunks[1].start=10.
        assert.deepStrictEqual(result, [
          { text: "hello   \n\n", start: 0, end: 10 },
          { text: "world", start: 10, end: 15 },
        ]);
      });

      it("paragraph with only whitespace contributes no anchored parts", () => {
        const input = "hello\n\n   \n\nworld";
        const result = split(input, {
          chunkSize: 5,
          chunkStrategy: "paragraph",
          splitter: charSplitter,
        });
        // Middle paragraph "   " trims to "" — no anchored parts.
        // chunks[0] (from "hello") extends forward through "\n\n   \n\n".
        assert.deepStrictEqual(result, [
          { text: "hello\n\n   \n\n", start: 0, end: 12 },
          { text: "world", start: 12, end: 17 },
        ]);
      });
    });

    // Chunks fully cover the input from chunks[0].start onward. (Leading
    // bytes before chunks[0].start may be uncovered by design.)
    describe("coverage invariant", () => {
      /**
       * @param {import("../src/split.js").Chunk[]} chunks
       * @param {number} totalLength
       */
      const assertCoversFromStart = (chunks, totalLength) => {
        if (chunks.length === 0) {
          return;
        }
        for (let i = 0; i < chunks.length - 1; i++) {
          assert.ok(
            chunks[i].end >= chunks[i + 1].start,
            `gap between chunk ${i} (end=${chunks[i].end}) and chunk ${i + 1} (start=${chunks[i + 1].start})`,
          );
        }
        assert.strictEqual(
          chunks[chunks.length - 1].end,
          totalLength,
          "last chunk must extend to end of input",
        );
      };

      it("whitespace-splitter string: gap whitespace absorbed", () => {
        const input = "hello   world!  test";
        const chunks = split(input, {
          chunkSize: 2,
          splitter: whitespaceSplitter,
        });
        assertCoversFromStart(chunks, input.length);
      });

      it("token-splitter string with emoji: dropped emoji bytes absorbed", () => {
        const input = "hello w👋🏻rld extra";
        const chunks = split(input, { chunkSize: 2, splitter: tokenSplitter });
        assertCoversFromStart(chunks, input.length);
      });

      it("paragraph mode: \\n\\n delimiters absorbed", () => {
        const input = "hello\n\nworld\n\ntest";
        const chunks = split(input, {
          chunkSize: 1,
          chunkStrategy: "paragraph",
          splitter: whitespaceSplitter,
        });
        assertCoversFromStart(chunks, input.length);
      });

      it("array input with overlap: total length is sum of element lengths", () => {
        const input = ["hello world", "test string"];
        const chunks = split(input, {
          chunkSize: 2,
          chunkOverlap: 1,
          splitter: whitespaceSplitter,
        });
        const totalLength = input.reduce((sum, s) => sum + s.length, 0);
        assertCoversFromStart(chunks, totalLength);
      });

      it("paragraph mode with array: every chunk's text matches its position", () => {
        const input = ["hello\n\nworld", "test\n\nstring"];
        const chunks = split(input, {
          chunkSize: 1,
          chunkStrategy: "paragraph",
          splitter: whitespaceSplitter,
        });
        const totalLength = input.reduce((sum, s) => sum + s.length, 0);
        assertCoversFromStart(chunks, totalLength);
        for (const chunk of chunks) {
          assert.deepStrictEqual(
            chunk.text,
            getChunk(input, chunk.start, chunk.end),
          );
        }
      });
    });

    describe("non-ASCII anchoring", () => {
      it("covers the whole input when a tokenizer fragments text with no ASCII", () => {
        // A tokenizer that splits a multi-byte character emits U+FFFD parts
        // matching nothing in the source. Resynchronizing after one must not
        // depend on finding a single-byte character to anchor against: this
        // input contains none, so a cursor stranded on the first fragment
        // would discard every part after it.
        const input = "这是一个测试文本用于检查分块边界的准确性。".repeat(10);
        const chunks = split(input, { chunkSize: 64, splitter: tokenSplitter });

        assert.strictEqual(chunks[0].start, 0);
        assert.strictEqual(
          chunks[chunks.length - 1].end,
          input.length,
          "must not stop at the first unanchorable fragment",
        );
        for (const chunk of chunks) {
          assert.strictEqual(
            chunk.text,
            getChunk(input, chunk.start, chunk.end),
          );
        }
      });

      it("locates ordinary parts that follow an unanchorable fragment", () => {
        // Same shape without the tokenizer: every fourth part is replaced by
        // U+FFFD. The parts around it are ordinary characters sitting verbatim
        // in the source and must still be found at their true offsets.
        const input = "这是一个测试文本用于检查分块";
        /** @param {string} text */
        const fragmentingSplitter = (text) =>
          [...text].map((ch, i) => (i % 4 === 3 ? "�" : ch));

        const chunks = split(input, {
          chunkSize: 2,
          splitter: fragmentingSplitter,
        });

        for (let i = 0; i < chunks.length - 1; i++) {
          assert.ok(
            chunks[i].end >= chunks[i + 1].start,
            `gap between chunk ${i} and ${i + 1}`,
          );
        }
        assert.strictEqual(chunks[chunks.length - 1].end, input.length);
      });

      it("locates a replacement char that is genuinely in the source", () => {
        // A part carrying U+FFFD is skipped past the verbatim search only
        // because such a part cannot occur in a source without one. This
        // source has one, so the part is findable and must be found at its
        // true offset (2), not at the "b" one code unit later.
        const input = "a �b";
        const chunks = split(input, {
          chunkSize: 1,
          splitter: whitespaceSplitter,
        });

        assert.deepStrictEqual(
          chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
          [
            ["a ", 0, 2],
            ["�b", 2, 4],
          ],
        );
        for (const chunk of chunks) {
          assert.strictEqual(
            chunk.text,
            getChunk(input, chunk.start, chunk.end),
          );
        }
      });

      it("does not anchor a manufactured replacement char on a literal one", () => {
        // tiktoken fragments the leading 漢 into two bare U+FFFD parts. The
        // source also holds a literal U+FFFD at index 14, which used to
        // re-enable the verbatim search, so a manufactured part matched that
        // literal one 13 code units downstream, stranded the cursor past
        // " world", and threw.
        const withLiteral = split("漢 hello world � tail", {
          chunkSize: 100,
          splitter: tokenSplitter,
        });
        // The same input with the replacement char swapped for an ordinary
        // character is the control, and it succeeds either way with
        // [{ text: " hello world X tail", start: 1, end: 20 }]. Comparing
        // against it is what isolates the U+FFFD as the cause rather than the
        // multi-byte character.
        const control = split("漢 hello world X tail", {
          chunkSize: 100,
          splitter: tokenSplitter,
        });

        assert.deepStrictEqual(
          withLiteral.map(({ start, end }) => [start, end]),
          control.map(({ start, end }) => [start, end]),
        );
        assert.deepStrictEqual(withLiteral, [
          { text: " hello world � tail", start: 1, end: 20 },
        ]);
      });

      it("drops a bare replacement part rather than matching a literal one", () => {
        // The same shape as above with no native dependency, so the regression
        // still bites if the tiktoken devDependency is ever dropped: "漢"
        // fragments into two bare U+FFFD parts, and the source holds a literal
        // one for them to spuriously match.
        /** @param {string} text */
        const fragmentingSplitter = (text) =>
          [...text].flatMap((ch) => (ch === "漢" ? ["�", "�"] : [ch]));

        const chunks = split("漢ab�cd", {
          chunkSize: 100,
          splitter: fragmentingSplitter,
        });

        assert.deepStrictEqual(chunks, [{ text: "ab�cd", start: 1, end: 6 }]);
      });

      it("anchors a mixed part at its left edge, not at its anchor grapheme", () => {
        // The anchor grapheme "c" sits 2 code units into the part, so the
        // part's left edge is 2 before it. Anchoring on "c" itself reports
        // [2,4) and advances the cursor two units too far.
        //
        // This pins the `- anchor.offset` subtraction only. It does not pin
        // the offset in the *search start*: "c" is found at index 2 whether
        // the search begins at the cursor, at cursor + 1, or at cursor + 2,
        // so all three produce [0,4) here. The test below covers that half.
        const chunks = split("abcd", {
          chunkSize: 8,
          splitter: () => ["��cd"],
        });

        assert.deepStrictEqual(
          chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
          [["abcd", 0, 4]],
        );
      });

      it("searches for the anchor grapheme forward of the part's left edge", () => {
        // Covers the other half of the tier 3 arithmetic: the `+ anchor.offset`
        // in the search start. The anchor "b" sits at part offset 1 and the
        // source holds another "b" at index 1, exactly where the cursor is.
        // Searching from the cursor finds that one and puts the part's start at
        // 0 — behind the cursor, and before the previous chunk ends, which
        // breaks the coverage invariant rather than throwing. Starting the
        // search at cursor + 1 is what rules it out.
        const chunks = split("abzb", {
          chunkSize: 1,
          splitter: () => ["a", "�b"],
        });

        assert.deepStrictEqual(
          chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
          [
            ["ab", 0, 2],
            ["zb", 2, 4],
          ],
        );
      });

      it("drops unanchorable parts without dropping mixed ones", () => {
        // Three shapes that all reach the anchor walk differently: nothing
        // but replacement chars (unanchorable outright), a combining mark
        // whose only company is a replacement char (no standalone position,
        // so also unanchorable), and a replacement char followed by real
        // source text (anchorable on that text, and must not be discarded
        // alongside the other two).
        const input = "abcd";
        const splitter = () => ["���", "́�", "�cd"];
        const chunks = split(input, { chunkSize: 8, splitter });

        // `[1,4)`, not `[2,4)`: the part "�cd" is 3 code units and a part's
        // span equals its length, so its left edge belongs at 4-3. The
        // replacement char stands in for the source's "b". Reporting 2 was the
        // anchor grapheme "c"'s own position standing in for the part's.
        assert.deepStrictEqual(
          chunks.map((chunk) => [chunk.text, chunk.start, chunk.end]),
          [["bcd", 1, 4]],
        );
      });

      it("anchors a verbatim mixed part after a dropped multi-char separator", () => {
        // The part's anchor grapheme "\n" also occurs inside the "\n\n" the
        // splitter dropped. Taking the first occurrence puts the part at 6,
        // two code units before its true start of 8; only checking the rest of
        // the part against the source rules that candidate out.
        /** @param {string} text */
        const paragraphSplitter = (text) => text.split("\n\n").filter(Boolean);

        const chunks = split("Intro.\n\n\nCaf� notes.\n\nEnd.", {
          chunkSize: 1,
          splitter: paragraphSplitter,
        });

        assert.deepStrictEqual(
          chunks.map(({ start, end }) => [start, end]),
          [
            [0, 8],
            [8, 22],
            [22, 26],
          ],
        );
      });

      it("rejects an anchor-grapheme match that the rest of the part contradicts", () => {
        // Same defect with no dependence on a delimiter shape. "a�b" is
        // verbatim at 4, but its anchor "a" also sits at 2, and only the "b"
        // two units on distinguishes the two candidates.
        const chunks = split("a a a�b", {
          chunkSize: 1,
          splitter: () => ["a", "a�b"],
        });

        assert.deepStrictEqual(
          chunks.map(({ start, end }) => [start, end]),
          [
            [0, 4],
            [4, 7],
          ],
        );
      });

      it("drops a part whose replacement char carries a combining mark", () => {
        // Order matters, which is why this is separate from the case above. A
        // mark *after* a replacement char merges into it, so `Intl.Segmenter`
        // reports one cluster rather than two — and that cluster is neither a
        // bare replacement char nor mark-only. Testing the two conditions
        // separately let it through as an anchor, and the anchor search then
        // failed on a character the splitter had invented, throwing instead of
        // dropping the part.
        const input = "café naïve";
        /** @param {string} text */
        const splitter = (text) =>
          [...text].map((ch) => (/\p{M}/u.test(ch) ? `�${ch}` : ch));

        const chunks = split(input, { chunkSize: 4, splitter });

        assert.strictEqual(chunks[chunks.length - 1].end, input.length);
        for (const chunk of chunks) {
          assert.strictEqual(
            chunk.text,
            getChunk(input, chunk.start, chunk.end),
          );
        }
      });
    });

    describe("anchoring cost", () => {
      // Every fourth part becomes a replacement char, the shape a BPE
      // tokenizer produces on dense multi-byte text. The source holds none,
      // so those parts exist nowhere in it and the verbatim search for them
      // can only fail — after scanning to the end of the input, which is
      // what once made whole-document splits quadratic.
      /** @param {string} text */
      const fragmentingSplitter = (text) =>
        [...text].map((ch, i) => (i % 4 === 3 ? "�" : ch));

      /** @param {number} size */
      const multibyteSource = (size) =>
        "这是一个测试文本用于检查分块边界的准确性。"
          .repeat(Math.ceil(size / 20))
          .slice(0, size);

      // Fastest of two runs: the minimum is the statistic that survives a
      // GC pause or a noisy CI box.
      /** @param {number} size */
      const fastestSplitMs = (size) => {
        const input = multibyteSource(size);
        let best = Infinity;
        for (let run = 0; run < 2; run++) {
          const started = performance.now();
          split(input, { chunkSize: 512, splitter: fragmentingSplitter });
          best = Math.min(best, performance.now() - started);
        }
        return best;
      };

      it("grows linearly with input size", () => {
        // An 8x span, not 2x: at 2x the quadratic term does not yet dominate
        // the linear per-part work at a size this suite can afford, and a
        // quadratic implementation measures only ~2.6x — inside any usable
        // margin. Across 8x, linear anchoring measures ~6-9x and quadratic
        // ~26-35x, so the threshold sits at twice the ideal factor with
        // room on both sides. If the baseline ever gets too small to divide
        // by, raise BASE rather than the threshold.
        //
        // BASE is 100_000 rather than 40_000 because the ratio is only as
        // stable as its denominator. At 40_000 the baseline measured 2.5-7ms,
        // and that spread alone moved observed growth between 5.4x and 12.1x
        // across repeated local runs — close enough to 16 that a loaded CI
        // runner could trip it with no regression present. A larger baseline
        // costs a little wall-clock and buys back the margin.
        const SPAN = 8;
        const BASE = 100_000;
        const baseline = fastestSplitMs(BASE);
        const scaled = fastestSplitMs(BASE * SPAN);

        assert.ok(
          baseline > 0,
          "baseline measurement must be greater than zero to divide by",
        );
        const growth = scaled / baseline;
        assert.ok(
          growth < SPAN * 2,
          `anchoring cost grew ${growth.toFixed(1)}x for a ${SPAN}x larger input (${baseline.toFixed(2)}ms -> ${scaled.toFixed(2)}ms); linear is ~${SPAN}x, quadratic ~${SPAN ** 2}x`,
        );
      });

      // The source above holds no U+FFFD, which was the only case the
      // linearity guarantee used to cover. A source that has one re-enabled
      // the verbatim search for every U+FFFD-bearing part, and that case was
      // carved out as a permanent limitation. It is not permanent: skipping
      // tier 2 for those parts closes it. Parts here are deliberately *mixed*
      // — one real char plus a manufactured U+FFFD — because those are the
      // ones that each paid a full failed scan. Two code units per part
      // against two of source, so length still equals span and the cursor
      // cannot run off the end.
      /** @param {string} text */
      const mixedFragmentingSplitter = (text) => {
        const chars = [...text];
        /** @type {string[]} */
        const parts = [];
        for (let i = 2; i + 1 < chars.length; i += 2) {
          parts.push(chars[i] + "�");
        }
        return parts;
      };

      /** @param {number} size */
      const fastestReplacementBearingMs = (size) => {
        const input = "� " + multibyteSource(size);
        let best = Infinity;
        for (let run = 0; run < 2; run++) {
          const started = performance.now();
          split(input, { chunkSize: 512, splitter: mixedFragmentingSplitter });
          best = Math.min(best, performance.now() - started);
        }
        return best;
      };

      it("grows linearly when the source itself contains U+FFFD", () => {
        // BASE is far smaller than the test above because every part here
        // reaches tier 3 and pays a grapheme segmentation, so the baseline is
        // already ~10ms — measured at 10.2-12.3ms across repeated runs, a
        // stable enough denominator. Growth measured 7.6-8.2x with the tier 2
        // skip in place and 45.3x without it, so the threshold sits with ~2x
        // margin below and ~3x above. Raise BASE, never the threshold.
        const SPAN = 8;
        const BASE = 12_500;
        const baseline = fastestReplacementBearingMs(BASE);
        const scaled = fastestReplacementBearingMs(BASE * SPAN);

        assert.ok(
          baseline > 0,
          "baseline measurement must be greater than zero to divide by",
        );
        const growth = scaled / baseline;
        assert.ok(
          growth < SPAN * 2,
          `anchoring cost grew ${growth.toFixed(1)}x for a ${SPAN}x larger U+FFFD-bearing input (${baseline.toFixed(2)}ms -> ${scaled.toFixed(2)}ms); linear is ~${SPAN}x, quadratic ~${SPAN ** 2}x`,
        );
      });
    });

    describe("negative inputs", () => {
      it("propagates errors thrown by the splitter", () => {
        const boomSplitter = () => {
          throw new Error("boom");
        };
        assert.throws(() => split("hello", { splitter: boomSplitter }), {
          message: "boom",
        });
      });

      it("rejects splitter that returns a string instead of an array", () => {
        assert.throws(
          () =>
            split("hello", {
              chunkSize: 1,
              // @ts-expect-error testing non-array splitter return
              splitter: (text) => text,
            }),
          {
            name: "TypeError",
            message:
              "Splitter must return an array of strings. Received: string",
          },
        );
      });

      it("rejects null input with a clear TypeError", () => {
        assert.throws(
          // @ts-expect-error null is not a valid input type
          () => split(null),
          {
            name: "TypeError",
            message:
              "Input must be a string or array of strings. Received: object",
          },
        );
      });

      it("rejects number input with a clear TypeError", () => {
        assert.throws(
          // @ts-expect-error number is not a valid input type
          () => split(42),
          {
            name: "TypeError",
            message:
              "Input must be a string or array of strings. Received: number",
          },
        );
      });

      it("rejects array input containing non-string elements", () => {
        assert.throws(
          // @ts-expect-error number inside array is not valid
          () => split(["hello", 42, "world"]),
          {
            name: "TypeError",
            message: "Input array elements must be strings. Found: number",
          },
        );
      });

      it("rejects a splitter that is not a function", () => {
        assert.throws(
          () =>
            split("hello", {
              // @ts-expect-error a string is not a splitter
              splitter: "not a function",
            }),
          { message: "Splitter must be a function" },
        );
      });

      it("rejects a splitter returning an array with a non-string element", () => {
        assert.throws(
          () =>
            split("hello", {
              chunkSize: 1,
              // @ts-expect-error testing non-string element in splitter return
              splitter: () => ["he", 42, "llo"],
            }),
          {
            message: "Splitter returned a non-string part: 42 for input: hello",
          },
        );
      });
    });

    describe("paragraph group offsets", () => {
      it("paragraph mode anchors next group at its real position, not first substring match", () => {
        // The second array element's content ("b") appears as a substring
        // inside the first ("ab"). Anchoring the group by substring search
        // landed it at offset 1 (inside "ab") instead of offset 2, silently
        // dropping the trailing "b". boundaryGroups now carries baseOffset
        // explicitly.
        const result = split(["ab", "b"], { chunkStrategy: "paragraph" });
        assert.deepStrictEqual(result, [
          { text: ["ab", "b"], start: 0, end: 3 },
        ]);
      });

      it("anchors a string paragraph whose text repeats earlier in the input", () => {
        // "three four" also occurs inside "two three four", ahead of the real
        // third paragraph. Locating a group by searching forward from the
        // previous group's offset finds that earlier occurrence, anchors the
        // group behind its true position, and drops the final paragraph.
        const input = "one\n\ntwo three four\n\nthree four";
        const chunks = split(input, {
          chunkSize: 3,
          splitter: whitespaceSplitter,
          chunkStrategy: "paragraph",
        });

        assert.deepStrictEqual(
          chunks.map((chunk) => [chunk.start, chunk.end]),
          [
            [0, 5],
            [5, 21],
            [21, 31],
          ],
        );
        assert.strictEqual(chunks[chunks.length - 1].text, "three four");
        assert.strictEqual(chunks[chunks.length - 1].end, input.length);
      });

      it("empty paragraphs do not poison subsequent group offset lookup", () => {
        // An empty middle array element used to advance baseOffset by one
        // position; the next paragraph's indexOf then started past its real
        // location and returned -1, throwing "Could not find start of group".
        // The empty middle element appears as "" in chunk text because
        // getChunk includes zero-width items that sit between start and end
        // positions.
        const result = split(["b", "", "b"], { chunkStrategy: "paragraph" });
        assert.deepStrictEqual(result, [
          { text: ["b", "", "b"], start: 0, end: 2 },
        ]);
      });
    });

    // The hand-written cases above each pin one known shape. This walks the
    // same contract across randomly combined inputs, splitters, strategies
    // and sizes, so a regression that lands between the shapes we thought to
    // enumerate still has something to trip over.
    describe("contract fuzz", () => {
      // Linear congruential generator (glibc constants). Seeded and stepped
      // by hand rather than using Math.random so a failure reproduces from
      // the printed seed instead of only happening once in CI.
      /** @param {number} seed */
      const rng = (seed) => {
        let state = seed >>> 0;
        return () => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 0x100000000;
        };
      };

      // Each alphabet targets a different part of the anchoring machinery:
      // pure ASCII stays on tier 1, whitespace exercises tier 2's forward
      // search, and the multi-byte sets drive tier 3 and the U+FFFD skip.
      // The last one matters most — a source that already holds U+FFFD is
      // what disables the tier 2 short-circuit.
      const ALPHABETS = [
        "abcdefg ",
        "ab \n\n",
        "这是一个测试文本。 \n\n",
        "देवनागरी लिपि \n\n",
        "a🤫b🕷️c \n\n",
        "éà \n\n",
        "a😀b \n\n",
        "  \n\n\t ",
        "ab�cd \n\n",
      ];

      // `mutates` records whether the splitter can emit a part that is not
      // verbatim in its source. Only those are allowed to fail to anchor;
      // see the assertion below.
      const SPLITTERS = [
        {
          name: "char",
          mutates: false,
          fn: (/** @type {string} */ t) => t.split(""),
        },
        {
          name: "codepoint",
          mutates: false,
          fn: (/** @type {string} */ t) => [...t],
        },
        {
          name: "whitespace",
          mutates: false,
          fn: (/** @type {string} */ t) => t.split(/\s+/),
        },
        {
          name: "space",
          mutates: false,
          fn: (/** @type {string} */ t) => t.split(" "),
        },
        {
          name: "runs-of-3",
          mutates: false,
          fn: (/** @type {string} */ t) => t.match(/[\s\S]{1,3}/g) ?? [],
        },
        {
          name: "utf16-pairs",
          mutates: false,
          fn: (/** @type {string} */ t) => t.match(/[\s\S]{1,2}/g) ?? [],
        },
        {
          name: "drop-every-3rd",
          mutates: false,
          fn: (/** @type {string} */ t) => [...t].filter((_, i) => i % 3 !== 1),
        },
        {
          name: "interleaved-empties",
          mutates: false,
          fn: (/** @type {string} */ t) => t.split("").flatMap((c) => ["", c]),
        },
        // Models a BPE tokenizer decoding tokens that straddle a multi-byte
        // boundary: every nth part comes back as U+FFFD.
        {
          name: "fragmenting-4",
          mutates: true,
          fn: (/** @type {string} */ t) =>
            [...t].map((c, i) => (i % 4 === 3 ? "�" : c)),
        },
        {
          name: "fragmenting-7",
          mutates: true,
          fn: (/** @type {string} */ t) =>
            [...t].map((c, i) => (i % 7 === 0 ? "�" : c)),
        },
        {
          name: "all-replacement",
          mutates: true,
          fn: (/** @type {string} */ t) => [...t].map(() => "�"),
        },
      ];

      // 20k cases run in roughly a quarter second, so there is no reason to
      // economize below that. Past this point a fixed seed only walks further
      // down one sequence — if you are chasing something specific, vary SEED
      // rather than pushing CASES much higher.
      const CASES = 20_000;
      const SEED = 0x2f6e2b1;

      it("holds the coverage contract across randomized inputs", () => {
        const next = rng(SEED);
        /** @param {number} n */
        const int = (n) => Math.floor(next() * n);

        let anchored = 0;
        let unanchorable = 0;

        for (let caseIndex = 0; caseIndex < CASES; caseIndex++) {
          const alphabet = ALPHABETS[int(ALPHABETS.length)];
          /** @param {number} n */
          const text = (n) =>
            Array.from(
              { length: n },
              () => alphabet[int(alphabet.length)],
            ).join("");

          /** @type {string|string[]} */
          const input =
            next() < 0.35
              ? Array.from({ length: int(4) }, () => text(int(40)))
              : text(int(120));

          const splitter = SPLITTERS[int(SPLITTERS.length)];
          const chunkSize = 1 + int(12);
          const chunkOverlap = int(chunkSize);
          const chunkStrategy = next() < 0.5 ? "character" : "paragraph";

          // Printed on every failure: enough to replay the exact case
          // without re-deriving it from the seed.
          const where = `case ${caseIndex} (seed ${SEED}): splitter=${splitter.name} chunkSize=${chunkSize} chunkOverlap=${chunkOverlap} chunkStrategy=${chunkStrategy} input=${JSON.stringify(input)}`;

          /** @type {Chunk[]} */
          let chunks;
          try {
            chunks = split(input, {
              chunkSize,
              chunkOverlap,
              splitter: splitter.fn,
              chunkStrategy,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            // A splitter that rewrites its parts may legitimately fail to
            // anchor. One that preserves them must never fail — that is the
            // property worth pinning, and it is what regressed historically.
            assert.ok(
              splitter.mutates && /could not be located in input/.test(message),
              `${where}\n  unexpected throw: ${message}`,
            );
            unanchorable++;
            continue;
          }
          anchored++;

          const inputs = Array.isArray(input) ? input : [input];
          const total = inputs.reduce((sum, item) => sum + item.length, 0);

          // A splitter can anchor nothing at all (whitespace-only source,
          // all-replacement splitter); there is no contract to check then.
          if (chunks.length === 0) {
            continue;
          }

          for (const chunk of chunks) {
            assert.deepStrictEqual(
              chunk.text,
              getChunk(input, chunk.start, chunk.end),
              `${where}\n  chunk.text disagrees with getChunk at [${chunk.start},${chunk.end})`,
            );
            assert.ok(
              chunk.start >= 0 && chunk.end <= total,
              `${where}\n  chunk [${chunk.start},${chunk.end}) outside [0,${total})`,
            );
            assert.ok(
              chunk.start <= chunk.end,
              `${where}\n  chunk start ${chunk.start} exceeds end ${chunk.end}`,
            );
          }

          assert.strictEqual(
            chunks[chunks.length - 1].end,
            total,
            `${where}\n  last chunk must end at total input length`,
          );

          for (let i = 0; i + 1 < chunks.length; i++) {
            assert.ok(
              chunks[i].end >= chunks[i + 1].start,
              `${where}\n  gap between chunk ${i} [${chunks[i].start},${chunks[i].end}) and ${i + 1} [${chunks[i + 1].start},${chunks[i + 1].end})`,
            );
            assert.ok(
              chunks[i].start <= chunks[i + 1].start,
              `${where}\n  chunk starts went backwards at ${i + 1}`,
            );
            if (chunkOverlap === 0) {
              assert.ok(
                chunks[i].end <= chunks[i + 1].start,
                `${where}\n  chunks overlap despite chunkOverlap=0 at ${i}`,
              );
            }
          }
        }

        // Guards the generator itself: if a refactor made every case throw or
        // every case trivial, the loop above would pass while checking almost
        // nothing.
        assert.ok(
          anchored > CASES * 0.9,
          `expected most cases to anchor, got ${anchored}/${CASES} (${unanchorable} unanchorable)`,
        );
      });
    });
  });
});
