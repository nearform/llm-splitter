// TODO: Resolve the baseline from the published package (`npm i -D llm-splitter`
// and `import { split, getChunk } from "llm-splitter"`) instead of a sibling
// checkout, so this runs without cloning and building a second repo. Blocked
// until the rewrite ships, because right now both names resolve to this repo.
/**
 * Head-to-head benchmark: this working copy vs. the published `llm-splitter`.
 *
 * Run it after any algorithm change in `src/split.js`. Verify perf claims by
 * measuring, not by reasoning — the `findGrapheme` slow path was assumed fine
 * until this benchmark surfaced a 659x worst-case slowdown against
 * byte-dropping splitters. The fix (replacing an `Intl.Segmenter` walk over
 * `input.slice(cursor)` with a native `indexOf`) was obvious in hindsight; the
 * magnitude was not, until it was measured.
 *
 * ## Public API only
 *
 * Both sides are driven through `split()` and `getChunk()` — the only exports
 * the two versions have in common, and the only ones a consumer can rely on.
 * (The published library also exports `splitToParts`; this copy does not, so
 * the benchmark cannot use it.) Everything the diff report knows is derived
 * from `{ text, start, end }` chunk objects plus `getChunk()`. Nothing reaches
 * into module internals, so a scenario that looks wrong here is wrong for a
 * consumer too.
 *
 * ## Prerequisite
 *
 * Needs a built checkout of the published library as a SIBLING directory, so
 * that `../../llm-splitter/dist/index.js` resolves from this file:
 *
 *     git clone https://github.com/nearform/llm-splitter ../llm-splitter
 *     cd ../llm-splitter && npm ci && npm run build
 *
 * Without it the import below throws ERR_MODULE_NOT_FOUND. There is no
 * fallback — a head-to-head against the shipped code is the entire point.
 *
 * ## Run
 *
 *     node test/benchmark.js                  # timings + mismatch counts
 *     node test/benchmark.js --diff           # + classified diff report
 *     node test/benchmark.js --corpus=latin   # just the original matrix
 *     node test/benchmark.js --diff-json=d.json
 *     node test/benchmark.js --help
 *
 * ## What it measures
 *
 * Per corpus, a 90-scenario matrix: input size (1KB / 10KB / 100KB) x chunk
 * strategy (character / paragraph) x chunkSize (64 / 512 / 2048) x overlap
 * (0 / 32) x splitter (char / whitespace / tiktoken). The 18 combinations the
 * old library rejects outright (overlap >= chunkSize / 2) are skipped, leaving
 * 90 of 108. Each scenario warms up once, then reports the median of 5 runs
 * (3 at 100KB).
 *
 * The `latin` corpus reproduces the original matrix byte-for-byte (including
 * the emoji sprinkled into the 10KB input), so its numbers stay comparable to
 * earlier runs. `cjk` and `devanagari` were added because the Latin generator
 * cannot exercise the multibyte anchoring paths that differ most between the
 * two versions — with a tokenizer splitter the published library discards
 * nearly every non-Latin part.
 *
 * ## Reading the results
 *
 * Both libraries run against identical generated input and their chunks are
 * compared field by field, so this is a correctness check as much as a timing
 * one. Differences are classified rather than lumped into one integer:
 *
 * - `cnt`   chunk-count difference between the two versions.
 * - `pos`   chunks whose `start` differs — genuine anchoring divergence.
 * - `end`   chunks whose `start` agrees but `end` does not — expected, this
 *           copy extends each chunk forward to the next chunk's start so that
 *           every code unit is attributable (the coverage invariant).
 * - `gap`   code units no chunk accounts for (internal gaps + uncovered tail).
 * - `bad`   chunks where `text !== getChunk(input, start, end)` — a broken
 *           public contract, and always a bug in whichever side reports it.
 *
 * Expect position differences in multibyte scenarios where this copy
 * deliberately anchors better than the published one — read the diff report,
 * don't assume they are regressions.
 *
 * ## Normalization: separating intended changes from real ones
 *
 * Most raw differences are changes we chose to make, so comparing verbatim
 * buries the interesting cases. Each intended change is written down as a
 * `NORMALIZERS` entry — a prose rule plus a transform that rewrites the
 * *baseline* to follow this copy's rule. Run with normalizers on (the
 * default) and whatever still differs is a **real** difference, reported
 * under "REAL DIFFERENCES" and labelled by `residual`.
 *
 * A normalizer doubles as documentation: if the rule cannot be stated
 * crisply enough to implement, it is not yet a decision. Changes that alter
 * how the input is carved up (rather than how a chunk is reported) cannot be
 * undone from chunk output — those are catalogued in `NON_NORMALIZABLE` and
 * explain every surviving residual. `--explain` prints both catalogues;
 * `--raw` turns normalization off.
 *
 * Deliberately not wired into `npm run check` (it needs that sibling checkout).
 * `npm test` globs `test/*.test.js`, so the runner skips this file, and `files`
 * in package.json lists only `src` and `dist`, so it is never published.
 */

import { writeFileSync } from "node:fs";
import {
  split as splitOld,
  getChunk as getChunkOld,
} from "../../llm-splitter/dist/index.js";
import { split as splitNew, getChunk as getChunkNew } from "../src/index.js";
import tiktoken from "tiktoken";

const tt = tiktoken.encoding_for_model("text-embedding-ada-002");
const td = new TextDecoder();

/** @type {Record<string, (input: string) => string[]>} */
const splitters = {
  char: (text) => text.split(""),
  whitespace: (text) => text.split(/\s+/),
  tiktoken: (text) =>
    Array.from(tt.encode(text)).map((token) =>
      td.decode(tt.decode(new Uint32Array([token]))),
    ),
};

// ----- CLI ----------------------------------------------------------------

const HELP = `
Head-to-head benchmark: this working copy vs. the published llm-splitter.

  --corpus=NAME[,NAME]   latin | cjk | devanagari | all   (default: all)
  --sizes=NAME[,NAME]    1KB | 10KB | 100KB               (default: all)
  --diff                 print a classified diff report after the table
  --diff-json[=FILE]     emit the same data as JSON (stdout when FILE omitted)
  --examples=N           divergent chunks to show per scenario (default: 3)
  --normalize[=A,B]      subtract documented differences before comparing, so
                         only real ones remain (default: all normalizers)
  --raw                  compare verbatim, applying no normalizers
  --explain              print the normalizer catalogue and exit
  --color / --no-color   force or suppress ANSI color (default: auto/TTY)
  --help                 this message

The latin corpus reproduces the original 90-scenario matrix exactly; cjk and
devanagari add the multibyte coverage the Latin generator cannot reach.
`;

/** @param {string[]} argv */
const parseArgs = (argv) => {
  const opts = {
    corpora: ["latin", "cjk", "devanagari"],
    sizes: ["1KB", "10KB", "100KB"],
    diff: false,
    diffJson: /** @type {string|null|undefined} */ (undefined),
    examples: 3,
    // Normalizers are on by default: the interesting question is what differs
    // *beyond* the changes we chose to make. `--raw` turns them off.
    normalize: /** @type {string[]|null} */ (null),
    explain: false,
    // Auto: color when writing to a terminal, unless NO_COLOR asks otherwise
    // (https://no-color.org). Piping to a file or a pager stays plain.
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  };

  for (const arg of argv) {
    const [flag, value] = arg.split("=");
    if (flag === "--help" || flag === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (flag === "--corpus") {
      opts.corpora =
        value === "all"
          ? opts.corpora
          : (value ?? "").split(",").filter(Boolean);
    } else if (flag === "--sizes") {
      opts.sizes = (value ?? "").split(",").filter(Boolean);
    } else if (flag === "--diff") {
      opts.diff = true;
    } else if (flag === "--diff-json") {
      opts.diffJson = value ?? null;
    } else if (flag === "--examples") {
      opts.examples = Number(value);
    } else if (flag === "--normalize") {
      // Bare --normalize keeps the null "all" sentinel.
      opts.normalize = value ? value.split(",").filter(Boolean) : null;
    } else if (flag === "--raw") {
      opts.normalize = [];
    } else if (flag === "--explain") {
      opts.explain = true;
    } else if (flag === "--color") {
      opts.color = true;
    } else if (flag === "--no-color") {
      opts.color = false;
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.log(HELP);
      process.exit(1);
    }
  }

  return opts;
};

const args = parseArgs(process.argv.slice(2));

// ----- color + table rendering --------------------------------------------

// `console.table` inspects cell values, which escapes ANSI sequences into
// literal "\x1B[31m" text — so a colored table has to be rendered by hand.

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  orange: "\x1b[38;5;208m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

/**
 * @param {string} code
 * @param {string|number} text
 */
const paint = (code, text) =>
  args.color ? `${code}${text}${ANSI.reset}` : String(text);

// Ratio thresholds for the new implementation's wall-clock vs. the old.
// SLOWER starts above 1 plus a noise band: the 1KB scenarios run in
// hundredths of a millisecond, where a couple of percent is scheduling
// jitter, not a regression.
const RATIO_NOISE_BAND = 1.05;
const RATIO_MUCH_SLOWER = 2.0;
const RATIO_FASTER = 0.9;

/** @param {number} ratio */
const ratioColor = (ratio) => {
  if (!Number.isFinite(ratio)) {
    return null;
  }
  if (ratio >= RATIO_MUCH_SLOWER) {
    return ANSI.red;
  }
  if (ratio > RATIO_NOISE_BAND) {
    return ANSI.orange;
  }
  if (ratio <= RATIO_FASTER) {
    return ANSI.green;
  }
  return null;
};

/** @param {number} ratio @param {string|number} text */
const paintByRatio = (ratio, text) => {
  const code = ratioColor(ratio);
  return code ? paint(code, text) : String(text);
};

// Severity palette for the correctness columns, matching the perf columns'
// intent — the eye should land on the same colors for the same reason:
//   red    something is broken (a library violates its own contract, or this
//          copy loses source text)
//   orange the two versions disagree; worth reading the diff report
//   dim    a difference that is expected by design (forward extension)
//   plain  no difference
/**
 * @param {number|string} value
 * @param {{ warn?: boolean, bad?: boolean, expected?: boolean }} level
 */
const paintSeverity = (
  value,
  { warn = false, bad = false, expected = false },
) => {
  if (bad) {
    return paint(ANSI.red, value);
  }
  if (warn) {
    return paint(ANSI.orange, value);
  }
  if (expected) {
    return paint(ANSI.dim, value);
  }
  return String(value);
};

// eslint-disable-next-line no-control-regex -- matching ANSI escapes needs ESC
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Printable width, ignoring the escape sequences that carry no width. */
/** @param {string|number} text */
const visibleWidth = (text) => String(text).replace(ANSI_PATTERN, "").length;

/**
 * GitHub-flavored Markdown table, padded to a fixed column width so it also
 * reads as an aligned table in a terminal. Padding is computed on *visible*
 * width, so colored cells line up like plain ones.
 *
 * Colors are suppressed when stdout is not a TTY, which means piping or
 * redirecting the output yields clean, paste-ready Markdown.
 *
 * @param {Record<string, string|number>[]} tableRows
 */
const renderTable = (tableRows) => {
  if (tableRows.length === 0) {
    return;
  }

  const columns = Object.keys(tableRows[0]);
  /** @param {string|number} value */
  const plain = (value) => String(value).replace(ANSI_PATTERN, "");
  const rightAlign = columns.map((col) =>
    tableRows.every((r) => /^[\d./]+$/.test(plain(r[col]))),
  );
  // Markdown needs at least three dashes in the separator row.
  const widths = columns.map((col) =>
    Math.max(col.length, 3, ...tableRows.map((r) => visibleWidth(r[col]))),
  );

  /**
   * @param {string} text
   * @param {number} width
   * @param {boolean} right
   */
  const pad = (text, width, right) => {
    const fill = " ".repeat(Math.max(0, width - visibleWidth(text)));
    return right ? `${fill}${text}` : `${text}${fill}`;
  };

  /** @param {string[]} cells */
  const row = (cells) => `| ${cells.join(" | ")} |`;

  console.log(
    row(columns.map((c, i) => paint(ANSI.bold, pad(c, widths[i], false)))),
  );
  console.log(
    row(
      widths.map((w, i) =>
        rightAlign[i] ? `${"-".repeat(w - 1)}:` : "-".repeat(w),
      ),
    ),
  );
  for (const r of tableRows) {
    console.log(
      row(columns.map((c, i) => pad(String(r[c]), widths[i], rightAlign[i]))),
    );
  }
};

// ----- input generators ---------------------------------------------------

const WORDS = (
  "the quick brown fox jumps over a lazy dog while pondering ineffable " +
  "mysteries of recursion and corecursion in late summer rainstorms across " +
  "an indifferent yet luminous horizon punctuated by errant seagulls"
).split(/\s+/);

// Devanagari mirrors the Latin corpus: space-delimited words, so the
// `whitespace` splitter stays meaningful and only the byte width changes.
const DEVANAGARI_WORDS = (
  "नमस्ते दुनिया यह एक परीक्षण है और लंबा पाठ पहाड़ों में बारिश के बाद " +
  "आकाश साफ हुआ पक्षी उड़ते रहे नदी बहती रही जंगल शांत था"
).split(/\s+/);

// CJK has no inter-word whitespace, so the units join with "" — that is the
// point: `whitespace` collapses to a single part and the tokenizer path is
// the only one that can chunk this at all.
const CJK_WORDS = (
  "这是 一个 测试 文本 用于 检查 分块 边界 的 准确性 " +
  "夏天 的 雨 停了 天空 变得 清澈 鸟儿 飞过 河流 森林 安静"
).split(/\s+/);

const EMOJI = ["🤫", "🕷️", "🏔️", "🔍", "🌌", "✨", "🦊", "🐝"];

/**
 * Generate roughly `targetBytes` of text with a paragraph break every 80
 * words. With `words = WORDS` and `separator = " "` this is byte-identical to
 * the original generator, so `latin` results stay comparable across runs.
 *
 * @param {number} targetBytes
 * @param {{ words?: string[], separator?: string, withEmoji?: boolean }} [config]
 */
const makeText = (
  targetBytes,
  { words = WORDS, separator = " ", withEmoji = false } = {},
) => {
  const parts = [];
  let bytes = 0;
  let wordsInPara = 0;
  let i = 0;
  while (bytes < targetBytes) {
    const word = words[i++ % words.length];
    parts.push(word);
    bytes += word.length + separator.length;
    wordsInPara += 1;
    if (withEmoji && i % 13 === 0) {
      const e = EMOJI[i % EMOJI.length];
      parts.push(e);
      bytes += e.length + 1;
    }
    if (wordsInPara >= 80) {
      parts.push("\n\n");
      bytes += 2;
      wordsInPara = 0;
    } else {
      parts.push(separator);
    }
  }
  return parts.join("");
};

/** @type {Record<string, { words: string[], separator: string, emojiAt: string|null }>} */
const CORPORA = {
  // Emoji only at 10KB — preserves the original matrix exactly.
  latin: { words: WORDS, separator: " ", emojiAt: "10KB" },
  cjk: { words: CJK_WORDS, separator: "", emojiAt: null },
  devanagari: { words: DEVANAGARI_WORDS, separator: " ", emojiAt: null },
};

// ----- comparison (public API only) ---------------------------------------

/**
 * A chunk reduced to the three public fields, with `text` flattened to a
 * string so array and string inputs compare the same way.
 *
 * @typedef {object} FlatChunk
 * @property {string} text
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} Coverage
 * @property {number} leading
 * @property {number} internal
 * @property {number} tail
 */

/**
 * @typedef {object} Example
 * @property {number} index
 * @property {{ start: number, end: number }} old
 * @property {{ start: number, end: number }} new
 * @property {string} oldTail
 * @property {string} newTail
 */

/**
 * @typedef {object} Classification
 * @property {number} countDiff
 * @property {number} oldCount
 * @property {number} newCount
 * @property {number} posDiff
 * @property {number} endOnlyDiff
 * @property {number} endExtended
 * @property {number} endShrunk
 * @property {number} textDiff
 * @property {number} compared
 * @property {Example[]} examples
 */

/** @param {string|string[]|null} text */
const asString = (text) => {
  if (text == null) {
    return "";
  }
  return Array.isArray(text) ? text.join("") : text;
};

/**
 * @param {{ text: string|string[]|null, start: number, end: number }[]} chunks
 * @returns {FlatChunk[]}
 */
const normalizeChunks = (chunks) =>
  chunks.map((c) => ({ text: asString(c.text), start: c.start, end: c.end }));

/**
 * Code units the chunk list fails to account for, measured only from the
 * public `{ start, end }` fields.
 *
 * - `leading` precedes `chunks[0].start` (no previous chunk to extend into,
 *   so this copy leaves it uncovered by design).
 * - `internal` sits between one chunk's `end` and the next chunk's `start`.
 * - `tail` follows the last chunk's `end`.
 */
/**
 * @param {FlatChunk[]} chunks
 * @param {number} totalLength
 * @returns {Coverage}
 */
const coverage = (chunks, totalLength) => {
  if (chunks.length === 0) {
    return { leading: 0, internal: 0, tail: totalLength };
  }

  let internal = 0;
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].end < chunks[i + 1].start) {
      internal += chunks[i + 1].start - chunks[i].end;
    }
  }

  return {
    leading: chunks[0].start,
    internal,
    tail: Math.max(0, totalLength - chunks[chunks.length - 1].end),
  };
};

/**
 * Chunks whose `text` disagrees with what their own `start`/`end` point at.
 * Uses each library's own `getChunk`, so this validates the public
 * text/position contract rather than trusting the returned text.
 */
/**
 * @param {{ text: string|string[]|null, start: number, end: number }[]} chunks
 * @param {string} input
 * @param {(input: string|string[], start: number, end: number) => string|string[]} getChunk
 */
const contractViolations = (chunks, input, getChunk) =>
  chunks.filter(
    (c) => asString(c.text) !== asString(getChunk(input, c.start, c.end)),
  ).length;

// ----- normalization ------------------------------------------------------

/**
 * A *documented, intentional* divergence between the two versions, expressed
 * as a transform that removes it from the comparison.
 *
 * The point is subtractive: apply every normalizer that describes a change we
 * meant to make, and whatever still differs afterwards is a **real**
 * difference — either an unintended regression, or a change nobody wrote down.
 * A normalizer is therefore also a piece of documentation: if you cannot state
 * the rule crisply enough to implement it here, it is not yet a decision.
 *
 * Normalizers only ever rewrite the *baseline* (old) side toward this copy's
 * documented rules. They never touch this copy's output — otherwise a genuine
 * regression could be normalized away.
 *
 * @typedef {object} Normalizer
 * @property {string} name
 * @property {string} rule What the two versions do differently.
 * @property {(chunks: FlatChunk[], input: string) => FlatChunk[]} apply
 */

/** @type {Normalizer[]} */
const NORMALIZERS = [
  {
    name: "coverage-extension",
    rule:
      "Old ends each chunk at its last anchored part, leaving inter-part " +
      "text (stripped whitespace, paragraph delimiters, dropped fragments) " +
      "attributed to no chunk. This copy extends every chunk's end forward " +
      "to the next chunk's start, and the last chunk to the end of input, " +
      "so every code unit from chunks[0].start on belongs to some chunk.",
    apply: (chunks, input) =>
      chunks.map((c, i) => {
        const nextStart =
          i < chunks.length - 1 ? chunks[i + 1].start : input.length;
        // Never shrink: with chunkOverlap the next chunk starts *before*
        // this one ends, and that overlap is intentional.
        const end = Math.max(c.end, Math.min(nextStart, input.length));
        return { start: c.start, end, text: input.slice(c.start, end) };
      }),
  },
  {
    name: "trailing-whitespace",
    rule:
      "A consequence of coverage-extension: this copy's chunk text can carry " +
      "trailing whitespace and \\n\\n delimiters absorbed from the gap, where " +
      "old's text stopped at the last part. Compares text without trailing " +
      "whitespace so only structural differences remain.",
    apply: (chunks) =>
      chunks.map((c) => ({ ...c, text: c.text.replace(/\s+$/, "") })),
  },
];

/**
 * Differences that cannot be normalized away from chunk output alone, because
 * they change how the input is carved up rather than how a chunk is reported.
 * They are the reason `chunk-count` and `anchor-drift` residuals survive, and
 * they are documented here so a residual is never a mystery.
 */
const NON_NORMALIZABLE = [
  {
    name: "part-retention",
    rule:
      "Old discards any splitter part containing no character <= U+00FF " +
      "(SINGLE_BYTE_CHAR_LIMIT). This copy anchors those parts instead. " +
      "Retaining different parts changes how many land in each chunk, so " +
      "chunk boundaries diverge and cannot be reconciled after the fact. " +
      "Shows up as chunk-count, and as anchor-drift once counts realign.",
  },
  {
    name: "paragraph-group-anchoring",
    rule:
      "In paragraph mode old locates each group with " +
      "indexOf(paragraph, previousOffset + 1), which finds an earlier repeat " +
      "when a paragraph's text occurs more than once — likely in any " +
      "repetitive corpus. The group is then anchored behind its true " +
      "position and its parts can be judged already-emitted, dropping the " +
      "trailing chunk entirely. This copy tracks group offsets arithmetically.",
  },
];

const NORMALIZER_NAMES = NORMALIZERS.map((n) => n.name);

// `null` means "every normalizer"; `--raw` passes an empty list.
const activeNormalizers = args.normalize ?? NORMALIZER_NAMES;

for (const name of activeNormalizers) {
  if (!NORMALIZER_NAMES.includes(name)) {
    console.error(
      `Unknown normalizer: ${name} (have: ${NORMALIZER_NAMES.join(", ")})`,
    );
    process.exit(1);
  }
}

if (args.explain) {
  console.log(
    "\nDocumented differences between the published library and this",
  );
  console.log(
    "copy. Each is subtracted from the comparison by a normalizer of",
  );
  console.log("the same name; whatever still differs afterwards is real.\n");
  for (const n of NORMALIZERS) {
    console.log(
      `${n.name}${activeNormalizers.includes(n.name) ? "" : "  (off)"}`,
    );
    for (const line of n.rule.match(/.{1,70}(\s|$)/g) ?? []) {
      console.log(`    ${line.trim()}`);
    }
    console.log("");
  }
  console.log("Differences that CANNOT be normalized from chunk output — they");
  console.log(
    "change how the input is carved up, not how a chunk is reported:\n",
  );
  for (const n of NON_NORMALIZABLE) {
    console.log(`${n.name}`);
    for (const line of n.rule.match(/.{1,70}(\s|$)/g) ?? []) {
      console.log(`    ${line.trim()}`);
    }
    console.log("");
  }
  console.log("Residual labels once normalization has run:");
  console.log(
    "  chunk-count   the two versions produced a different number of chunks",
  );
  console.log(
    "  anchor-drift  same count, but chunk starts land in different places",
  );
  console.log("  chunk-end     ends still disagree after coverage-extension");
  console.log("  text-only     positions agree but text does not");
  console.log("  -             no difference left: fully explained\n");
  process.exit(0);
}

/**
 * `trailing-whitespace` compares text only, so it has to be applied to both
 * sides; every other normalizer rewrites the baseline alone.
 */
const SYMMETRIC_NORMALIZERS = new Set(["trailing-whitespace"]);

const TAIL_CHARS = 30;

/**
 * Classify every way the two chunk lists differ. Categories are disjoint per
 * field so the totals stay interpretable: `pos` counts chunks whose `start`
 * moved, `endOnly` counts chunks that start in the same place but end
 * somewhere else.
 */
/**
 * @param {FlatChunk[]} oldNorm
 * @param {FlatChunk[]} newNorm
 * @param {number} exampleLimit
 * @returns {Classification}
 */
const classify = (oldNorm, newNorm, exampleLimit) => {
  /** @type {Classification} */
  const result = {
    countDiff: oldNorm.length === newNorm.length ? 0 : 1,
    oldCount: oldNorm.length,
    newCount: newNorm.length,
    posDiff: 0,
    endOnlyDiff: 0,
    endExtended: 0,
    endShrunk: 0,
    textDiff: 0,
    compared: Math.min(oldNorm.length, newNorm.length),
    examples: [],
  };

  for (let i = 0; i < result.compared; i++) {
    const a = oldNorm[i];
    const b = newNorm[i];
    const startMoved = a.start !== b.start;
    const endMoved = a.end !== b.end;

    if (startMoved) {
      result.posDiff += 1;
    }
    if (!startMoved && endMoved) {
      result.endOnlyDiff += 1;
    }
    if (endMoved && b.end > a.end) {
      result.endExtended += 1;
    }
    if (endMoved && b.end < a.end) {
      result.endShrunk += 1;
    }
    if (a.text !== b.text) {
      result.textDiff += 1;
    }

    if (
      (startMoved || endMoved || a.text !== b.text) &&
      result.examples.length < exampleLimit
    ) {
      result.examples.push({
        index: i,
        old: { start: a.start, end: a.end },
        new: { start: b.start, end: b.end },
        oldTail: a.text.slice(-TAIL_CHARS),
        newTail: b.text.slice(-TAIL_CHARS),
      });
    }
  }

  return result;
};

// ----- timing -------------------------------------------------------------

/** @param {number[]} xs */
const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** @param {() => any} fn */
const timeOnce = (fn) => {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  return { ms: t1 - t0, result };
};

/**
 * @param {() => any} fn
 * @param {number} iter
 */
const measure = (fn, iter) => {
  fn(); // warmup
  const times = [];
  let lastResult;
  for (let i = 0; i < iter; i++) {
    const { ms, result } = timeOnce(fn);
    times.push(ms);
    lastResult = result;
  }
  return { ms: median(times), result: lastResult };
};

/** @param {string} sizeName */
const iterFor = (sizeName) => {
  if (sizeName === "100KB") {
    return 3;
  }
  return 5;
};

// ----- matrix -------------------------------------------------------------

// Stops at 100KB: the old library has an O(n²)-ish path that OOMs above this
// (and can destabilize macOS WindowServer). Don't raise without profiling.
const sizes = [
  { name: "1KB", bytes: 1024 },
  { name: "10KB", bytes: 10 * 1024 },
  { name: "100KB", bytes: 100 * 1024 },
].filter((s) => args.sizes.includes(s.name));
const strategies = /** @type {("character"|"paragraph")[]} */ ([
  "character",
  "paragraph",
]);
const chunkSizes = [64, 512, 2048];
const overlaps = [0, 32];
const splitterNames = ["char", "whitespace", "tiktoken"];

// Pre-generate inputs per corpus, keyed corpus -> size name -> text.
/** @type {Record<string, Record<string, string>>} */
const inputs = {};
for (const corpusName of args.corpora) {
  const corpus = CORPORA[corpusName];
  if (!corpus) {
    console.error(`Unknown corpus: ${corpusName}`);
    process.exit(1);
  }
  inputs[corpusName] = {};
  for (const s of sizes) {
    inputs[corpusName][s.name] = makeText(s.bytes, {
      words: corpus.words,
      separator: corpus.separator,
      withEmoji: corpus.emojiAt === s.name,
    });
  }
}

/**
 * @typedef {object} Scenario
 * @property {string} corpus
 * @property {{ name: string, bytes: number }} size
 * @property {"character"|"paragraph"} strategy
 * @property {number} chunkSize
 * @property {number} overlap
 * @property {string} splitterName
 */

/** @type {Scenario[]} */
const scenarios = [];
for (const corpus of args.corpora) {
  for (const size of sizes) {
    for (const strategy of strategies) {
      for (const chunkSize of chunkSizes) {
        for (const overlap of overlaps) {
          for (const splitterName of splitterNames) {
            if (overlap >= chunkSize / 2) {
              continue;
            } // old lib rejects
            scenarios.push({
              corpus,
              size,
              strategy,
              chunkSize,
              overlap,
              splitterName,
            });
          }
        }
      }
    }
  }
}

// ----- run ----------------------------------------------------------------

const rows = [];
/**
 * One scenario's full result. Uniform shape whether or not it errored, so
 * every consumer (table, report, JSON) can read the same fields.
 *
 * @typedef {object} ScenarioRecord
 * @property {string} label
 * @property {string} corpus
 * @property {string} size
 * @property {string} strategy
 * @property {number} chunkSize
 * @property {number} overlap
 * @property {string} splitter
 * @property {number} inputLength
 * @property {number} oldMs
 * @property {number} newMs
 * @property {number} ratio
 * @property {Classification} raw Differences as the two versions emit them.
 * @property {Classification} normalized Differences that survive NORMALIZERS.
 * @property {string[]} explainedBy Normalizers that changed the comparison.
 * @property {string} residual Why it still differs: "" once fully explained.
 * @property {Coverage} oldCoverage
 * @property {Coverage} newCoverage
 * @property {number} oldContractViolations
 * @property {number} newContractViolations
 * @property {string} error
 */

/**
 * Label what a scenario's *remaining* difference actually is, after the
 * documented ones have been normalized away.
 *
 * @param {Classification} c
 */
const residualReason = (c) => {
  if (c.countDiff) {
    return "chunk-count";
  }
  if (c.posDiff) {
    return "anchor-drift";
  }
  if (c.endOnlyDiff) {
    return "chunk-end";
  }
  if (c.textDiff) {
    return "text-only";
  }
  return "";
};

/** @type {ScenarioRecord[]} */
const records = [];
let totalErrors = 0;

for (const sc of scenarios) {
  const text = inputs[sc.corpus][sc.size.name];
  const splitter = splitters[sc.splitterName];

  const opts = {
    chunkSize: sc.chunkSize,
    chunkOverlap: sc.overlap,
    splitter,
    chunkStrategy: sc.strategy,
  };

  const scenarioLabel =
    `${sc.corpus} ${sc.size.name} ${sc.strategy} ` +
    `cs=${sc.chunkSize} ov=${sc.overlap} ${sc.splitterName}`;

  const empty = () => classify([], [], 0);

  /** @type {ScenarioRecord} */
  const record = {
    label: scenarioLabel,
    corpus: sc.corpus,
    size: sc.size.name,
    strategy: sc.strategy,
    chunkSize: sc.chunkSize,
    overlap: sc.overlap,
    splitter: sc.splitterName,
    inputLength: text.length,
    oldMs: NaN,
    newMs: NaN,
    ratio: NaN,
    raw: empty(),
    normalized: empty(),
    explainedBy: [],
    residual: "",
    oldCoverage: { leading: 0, internal: 0, tail: 0 },
    newCoverage: { leading: 0, internal: 0, tail: 0 },
    oldContractViolations: 0,
    newContractViolations: 0,
    error: "",
  };

  try {
    const iter = iterFor(sc.size.name);
    const o = measure(() => splitOld(text, opts), iter);
    const n = measure(() => splitNew(text, opts), iter);
    record.oldMs = o.ms;
    record.newMs = n.ms;
    record.ratio = n.ms / o.ms;

    const oldFlat = normalizeChunks(o.result);
    const newFlat = normalizeChunks(n.result);

    record.raw = classify(oldFlat, newFlat, args.examples);
    record.oldCoverage = coverage(oldFlat, text.length);
    record.newCoverage = coverage(newFlat, text.length);
    record.oldContractViolations = contractViolations(
      o.result,
      text,
      getChunkOld,
    );
    record.newContractViolations = contractViolations(
      n.result,
      text,
      getChunkNew,
    );

    // Apply each selected normalizer to the baseline (and, where the rule is
    // about text rather than positions, to both sides), then re-classify.
    // `explainedBy` records the ones that actually moved the needle.
    let oldAdjusted = oldFlat;
    let newAdjusted = newFlat;
    for (const normalizer of NORMALIZERS) {
      if (!activeNormalizers.includes(normalizer.name)) {
        continue;
      }
      const before = classify(oldAdjusted, newAdjusted, 0);
      oldAdjusted = normalizer.apply(oldAdjusted, text);
      if (SYMMETRIC_NORMALIZERS.has(normalizer.name)) {
        newAdjusted = normalizer.apply(newAdjusted, text);
      }
      const after = classify(oldAdjusted, newAdjusted, 0);
      if (
        after.posDiff !== before.posDiff ||
        after.endOnlyDiff !== before.endOnlyDiff ||
        after.textDiff !== before.textDiff
      ) {
        record.explainedBy.push(normalizer.name);
      }
    }
    record.normalized = classify(oldAdjusted, newAdjusted, args.examples);
    record.residual = residualReason(record.normalized);

    if (record.raw.countDiff || record.raw.posDiff || record.raw.endOnlyDiff) {
      console.error(
        `MISMATCH: ${scenarioLabel} — ` +
          `cnt=${record.raw.oldCount}/${record.raw.newCount} ` +
          `pos=${record.raw.posDiff} end=${record.raw.endOnlyDiff}` +
          (record.residual ? ` residual=${record.residual}` : " (explained)"),
      );
    }
    if (record.oldContractViolations || record.newContractViolations) {
      console.error(
        `CONTRACT VIOLATION: ${scenarioLabel} — ` +
          `old=${record.oldContractViolations} new=${record.newContractViolations}`,
      );
    }
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    totalErrors += 1;
    console.error(`ERROR: ${scenarioLabel} — ${record.error}`);
  }

  records.push(record);
  const errored = Boolean(record.error);
  const oldGap = record.oldCoverage.internal + record.oldCoverage.tail;
  const newGap = record.newCoverage.internal + record.newCoverage.tail;

  rows.push({
    corpus: sc.corpus,
    size: sc.size.name,
    strategy: sc.strategy,
    cs: sc.chunkSize,
    ov: sc.overlap,
    splitter: sc.splitterName,
    oldMs: errored ? "ERR" : record.oldMs.toFixed(2),
    // Colored by ratio: green = faster, orange = slower, red = >=2x slower.
    newMs: errored
      ? "ERR"
      : paintByRatio(record.ratio, record.newMs.toFixed(2)),
    ratio: errored
      ? "ERR"
      : paintByRatio(record.ratio, record.ratio.toFixed(2)),
    // Chunk counts disagreeing means the two versions carved the input up
    // differently — always worth a look.
    cnt: errored
      ? "ERR"
      : paintSeverity(`${record.raw.oldCount}/${record.raw.newCount}`, {
          warn: record.raw.countDiff > 0,
        }),
    // Moved starts are genuine anchoring divergence.
    pos: errored
      ? "ERR"
      : paintSeverity(record.raw.posDiff, { warn: record.raw.posDiff > 0 }),
    // Ends moving while starts agree is the coverage invariant doing its job.
    end: errored
      ? "ERR"
      : paintSeverity(record.raw.endOnlyDiff, {
          expected: record.raw.endOnlyDiff > 0,
        }),
    // Uncovered source, old/new. Red once *this* copy drops anything.
    gap: errored
      ? "ERR"
      : paintSeverity(`${oldGap}/${newGap}`, {
          bad: newGap > 0,
          warn: oldGap > 0,
        }),
    // text !== getChunk(start, end) is a broken contract on either side.
    bad: errored
      ? "ERR"
      : paintSeverity(
          record.oldContractViolations + record.newContractViolations,
          {
            bad:
              record.oldContractViolations + record.newContractViolations > 0,
          },
        ),
    // What is left once the documented differences are normalized away.
    // "-" means fully explained; anything else is a real difference.
    res: errored
      ? "ERR"
      : paintSeverity(record.residual || "-", {
          bad:
            record.residual === "chunk-end" || record.residual === "text-only",
          warn:
            record.residual === "chunk-count" ||
            record.residual === "anchor-drift",
        }),
  });
}

renderTable(rows);

if (args.color) {
  console.log("");
  console.log(
    `${paint(ANSI.dim, "perf ")}` +
      `${paint(ANSI.green, `faster (<=${RATIO_FASTER}x)`)}  ` +
      `${paint(ANSI.orange, `slower (>${RATIO_NOISE_BAND}x)`)}  ` +
      `${paint(ANSI.red, `much slower (>=${RATIO_MUCH_SLOWER}x)`)}`,
  );
  console.log(
    `${paint(ANSI.dim, "diff ")}` +
      `${paint(ANSI.orange, "versions disagree")}  ` +
      `${paint(ANSI.dim, "expected by design")}  ` +
      `${paint(ANSI.red, "broken contract / lost text")}`,
  );
}

// ----- summary ------------------------------------------------------------

// Read ratios off the records, not the table rows — the rendered cells may
// carry color escapes.
const validRatios = records
  .filter((r) => !r.error)
  .map((r) => r.ratio)
  .sort((a, b) => a - b);
const medianRatio = validRatios.length ? median(validRatios) : NaN;
const worstRatio = validRatios.length
  ? validRatios[validRatios.length - 1]
  : NaN;
const bestRatio = validRatios.length ? validRatios[0] : NaN;

const differing = records.filter(
  (r) => !r.error && (r.raw.countDiff || r.raw.posDiff || r.raw.endOnlyDiff),
);
const unexplained = records.filter((r) => !r.error && r.residual);

console.log("");
console.log(
  `Summary: scenarios=${scenarios.length}  median ratio=${medianRatio.toFixed(2)}x  ` +
    `best=${bestRatio.toFixed(2)}x  worst=${worstRatio.toFixed(2)}x  ` +
    `differing=${differing.length}  unexplained=${unexplained.length}  ` +
    `errors=${totalErrors}`,
);
console.log("(ratio = newMs / oldMs; >1 means rewrite is slower)");
console.log(
  activeNormalizers.length
    ? `(normalizers: ${activeNormalizers.join(", ")} — see --explain)`
    : "(no normalizers: raw comparison)",
);

// ----- diff report --------------------------------------------------------

/**
 * @param {ScenarioRecord[]} list
 * @param {(r: ScenarioRecord) => number} pick
 */
const sum = (list, pick) => list.reduce((acc, r) => acc + pick(r), 0);

/**
 * @param {ScenarioRecord} r
 * @param {Classification} c
 */
const printScenario = (r, c) => {
  console.log(
    `  chunks           old=${c.oldCount} new=${c.newCount}` +
      (c.countDiff ? "   <-- COUNT DIFFERS" : ""),
  );
  console.log(
    `  start differs    ${c.posDiff}/${c.compared}` +
      (c.posDiff ? "   <-- anchoring divergence" : ""),
  );
  console.log(
    `  end-only differs ${c.endOnlyDiff}/${c.compared}` +
      `   (new extends forward ${c.endExtended}, new shrinks ${c.endShrunk})`,
  );
  console.log(
    `  uncovered units  old lead=${r.oldCoverage.leading} ` +
      `gaps=${r.oldCoverage.internal} tail=${r.oldCoverage.tail}` +
      `  |  new lead=${r.newCoverage.leading} ` +
      `gaps=${r.newCoverage.internal} tail=${r.newCoverage.tail}`,
  );
  if (r.oldContractViolations || r.newContractViolations) {
    console.log(
      `  text != getChunk(start,end)   old=${r.oldContractViolations} ` +
        `new=${r.newContractViolations}   <-- BROKEN CONTRACT`,
    );
  }
  for (const e of c.examples) {
    console.log(
      `    [${e.index}] old [${e.old.start},${e.old.end}) ` +
        `new [${e.new.start},${e.new.end})`,
    );
    console.log(`          old ...${JSON.stringify(e.oldTail)}`);
    console.log(`          new ...${JSON.stringify(e.newTail)}`);
  }
};

const printDiffReport = () => {
  const ok = records.filter((r) => !r.error);

  console.log("");
  console.log("=".repeat(78));
  console.log("DIFF REPORT (raw, before normalization)");
  console.log("=".repeat(78));

  for (const r of differing) {
    console.log("");
    console.log(
      `${r.label}` +
        (r.explainedBy.length
          ? `   [explained by: ${r.explainedBy.join(", ")}]`
          : ""),
    );
    printScenario(r, r.raw);
  }

  console.log("");
  console.log("=".repeat(78));
  console.log("REAL DIFFERENCES (what survives normalization)");
  console.log("=".repeat(78));

  if (unexplained.length === 0) {
    console.log("");
    console.log("  None — every difference is accounted for by a documented");
    console.log("  normalizer. Run --explain to see the catalogue.");
  }

  for (const r of unexplained) {
    console.log("");
    console.log(`${r.label}   <-- residual: ${r.residual}`);
    printScenario(r, r.normalized);
  }

  console.log("");
  console.log("-".repeat(78));
  console.log("AGGREGATE");
  console.log("-".repeat(78));
  console.log(`  scenarios compared           ${ok.length}`);
  console.log(`  scenarios differing (raw)    ${differing.length}`);
  console.log(
    `  ... chunk-count differences  ${ok.filter((r) => r.raw.countDiff).length}`,
  );
  console.log(
    `  ... start-position diffs     ${ok.filter((r) => r.raw.posDiff).length}`,
  );
  console.log(
    `  ... end-only diffs           ${ok.filter((r) => r.raw.endOnlyDiff).length}`,
  );
  console.log(
    `  explained by normalization   ${differing.length - unexplained.length}`,
  );
  console.log(`  REAL differences remaining   ${unexplained.length}`);
  for (const reason of [
    "chunk-count",
    "anchor-drift",
    "chunk-end",
    "text-only",
  ]) {
    const n = ok.filter((r) => r.residual === reason).length;
    if (n) {
      console.log(`    ${reason.padEnd(26)} ${n}`);
    }
  }
  console.log(
    `  old uncovered code units     ${sum(ok, (r) => r.oldCoverage.leading + r.oldCoverage.internal + r.oldCoverage.tail)}` +
      ` (in ${ok.filter((r) => r.oldCoverage.internal || r.oldCoverage.tail).length} scenarios)`,
  );
  console.log(
    `  new uncovered code units     ${sum(ok, (r) => r.newCoverage.leading + r.newCoverage.internal + r.newCoverage.tail)}` +
      ` (in ${ok.filter((r) => r.newCoverage.internal || r.newCoverage.tail).length} scenarios)`,
  );
  console.log(
    `  contract violations          old=${sum(ok, (r) => r.oldContractViolations)} new=${sum(ok, (r) => r.newContractViolations)}`,
  );

  for (const corpus of args.corpora) {
    const sub = ok.filter((r) => r.corpus === corpus);
    if (sub.length === 0) {
      continue;
    }
    const ratios = sub.map((r) => r.ratio).sort((a, b) => a - b);
    console.log(
      `  [${corpus}] scenarios=${sub.length}` +
        ` differing=${sub.filter((r) => r.raw.countDiff || r.raw.posDiff || r.raw.endOnlyDiff).length}` +
        ` real=${sub.filter((r) => r.residual).length}` +
        ` medianRatio=${median(ratios).toFixed(2)}x` +
        ` oldUncovered=${sum(sub, (r) => r.oldCoverage.internal + r.oldCoverage.tail)}` +
        ` newUncovered=${sum(sub, (r) => r.newCoverage.internal + r.newCoverage.tail)}`,
    );
  }
};

if (args.diff) {
  printDiffReport();
}

if (args.diffJson !== undefined) {
  const payload = JSON.stringify(
    { scenarios: scenarios.length, errors: totalErrors, records },
    null,
    2,
  );
  if (args.diffJson) {
    writeFileSync(args.diffJson, payload);
    console.log(`\nWrote ${args.diffJson}`);
  } else {
    console.log(payload);
  }
}

tt.free();
