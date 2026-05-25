import { describe, it, after, before } from "node:test";
import assert from "node:assert";
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
          { text: ["hello world! ", "This is the"], start: 1, end: 25 },
          { text: ["split test string. Of words."], start: 26, end: 54 },
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
          { text: "hello world", start: 0, end: 11 },
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
          { text: "hello   world!", start: 0, end: 14 },
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
          { text: "test  string", start: 17, end: 29 },
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
            { text: "lo", start: 3, end: 5 },
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
            { text: "hello world", start: 0, end: 11 },
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
            { text: "hello", start: 0, end: 5 },
            { text: "world", start: 7, end: 12 },
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
            { text: "hello world", start: 0, end: 11 },
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
            { text: "short", start: 0, end: 5 },
            { text: "very long paragraph", start: 7, end: 26 },
            { text: "with many words", start: 27, end: 42 },
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
            { text: "hello", start: 0, end: 5 },
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
            { text: "hello", start: 0, end: 5 },
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
            { text: ["hello"], start: 0, end: 5 },
            { text: ["world"], start: 7, end: 12 },
            { text: ["test"], start: 12, end: 16 },
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
            { text: "lo", start: 3, end: 5 },
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

        it("should handle paragraph strategy with mixed content in array", () => {
          const input = ["hello\n\nworld", "test", "string\n\nend"];
          const result = split(input, {
            chunkSize: 2,
            chunkStrategy: "paragraph",
            splitter: whitespaceSplitter,
          });
          assert.deepStrictEqual(result, [
            { text: ["hello\n\nworld"], start: 0, end: 12 },
            { text: ["test", "string"], start: 12, end: 22 },
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
            { text: ["Hi there", "Another."], start: 89, end: 105 },
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
            { text: "hello w", start: 0, end: 7 },
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
            { text: "hello w👋🏻rld", start: 0, end: 14 },
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

    // Lock in current behavior for malformed splitters and inputs.
    // FIXME(B4): once B4 decides whether to throw on these, update assertions
    // and remove the FIXME comments.
    describe("negative inputs (current behavior)", () => {
      it("propagates errors thrown by the splitter", () => {
        const boomSplitter = () => {
          throw new Error("boom");
        };
        assert.throws(() => split("hello", { splitter: boomSplitter }), {
          message: "boom",
        });
      });

      it("FIXME(B4): splitter returning a string (not an array) iterates per-character", () => {
        // Each char of the returned string is treated as a separate part
        // because `for…of` over a string yields characters. Anchor logic
        // happens to make this work for the trivial case where the returned
        // string equals input.
        const result = split("hello", {
          chunkSize: 1,
          // @ts-expect-error testing non-array splitter return
          splitter: (text) => text,
        });
        assert.deepStrictEqual(result, [
          { text: "h", start: 0, end: 1 },
          { text: "e", start: 1, end: 2 },
          { text: "l", start: 2, end: 3 },
          { text: "l", start: 3, end: 4 },
          { text: "o", start: 4, end: 5 },
        ]);
      });

      it("FIXME(B4): null input throws an opaque 'could not find start of group' error", () => {
        assert.throws(
          // @ts-expect-error null is not a valid input type
          () => split(null),
          { message: /Could not find start of group/ },
        );
      });

      it("FIXME(B4): number input throws an opaque TypeError from the splitter", () => {
        assert.throws(
          // @ts-expect-error number is not a valid input type
          () => split(42),
          { name: "TypeError" },
        );
      });
    });

    // Failing-by-design regression tests for bugs surfaced in the adversarial
    // review. These use `it.todo` so they don't fail the suite, but they
    // assert the *post-fix* expected behavior — when the fix lands, flip them
    // back to plain `it`.
    describe("regressions (pending Phase 2 fix)", () => {
      it.todo(
        "B1: paragraph mode anchors next group at its real position, not first substring match",
        () => {
          // Adversarial: second array element's content ("b") appears as a
          // substring inside the first element ("ab"). Current implementation
          // anchors the second paragraph at offset 1 (inside "ab") instead of
          // offset 2 (start of second array element), and the trailing "b" is
          // silently dropped from output.
          const result = split(["ab", "b"], { chunkStrategy: "paragraph" });
          assert.deepStrictEqual(result, [
            { text: ["ab", "b"], start: 0, end: 3 },
          ]);
        },
      );

      it.todo(
        "B2: empty paragraphs do not poison subsequent group offset lookup",
        () => {
          // Adversarial: an empty middle array element advances baseOffset by
          // one position; the next paragraph's indexOf then starts past its
          // real location and returns -1, throwing "Could not find start of
          // group". Should produce a normal chunk covering both "b" elements.
          const result = split(["b", "", "b"], { chunkStrategy: "paragraph" });
          assert.deepStrictEqual(result, [
            { text: ["b", "b"], start: 0, end: 2 },
          ]);
        },
      );

      it.todo(
        "B7: cursor does not drift when splitter inflates a part's length",
        () => {
          // Synthetic splitter: appends a U+FFFD byte to each character so
          // splitPart.length (2) exceeds source span (1). Current
          // implementation uses splitPart.length to set `end` and then
          // `cursor = end`, drifting one position per part; the second
          // part's anchor 'b' (at source position 1) can't be found from
          // cursor=2 and the call throws. Note: real tokenizers (tiktoken)
          // don't produce this exact shape — this is a synthetic regression.
          const driftSplitter = (/** @type {string} */ text) =>
            text.split("").map((ch) => ch + "�");
          const result = split("abc", {
            chunkSize: 3,
            splitter: driftSplitter,
          });
          assert.deepStrictEqual(result, [{ text: "abc", start: 0, end: 3 }]);
        },
      );
    });
  });
});
