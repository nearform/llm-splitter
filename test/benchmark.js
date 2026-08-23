/**
 * Head-to-head benchmark: this working copy vs. the published `llm-splitter`.
 * Run it after any algorithm change in `src/split.js` — verify perf claims by
 * measuring, not by reasoning.
 *
 * ## Public API only
 *
 * Both sides are driven through `split()` and `getChunk()` — the only exports
 * the two versions have in common. Everything the diff report knows is derived
 * from `{ text, start, end }` chunk objects plus `getChunk()`, so a scenario
 * that looks wrong here is wrong for a consumer too.
 *
 * ## Prerequisite
 *
 * None beyond `npm ci`, but the FIRST run needs network: the baseline is
 * downloaded from a CDN into `test/.cache/` (gitignored) and reused offline
 * from then on. See `loadBaseline` below for why it is fetched rather than
 * installed or vendored.
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
 * The closing summary splits the two concerns apart: PERFORMANCE (ratio
 * distribution, plus any scenario this copy is *slower* on with its absolute
 * cost) then CORRECTNESS (what still disagrees, and whether any of it is text
 * lost or a broken contract). VERDICT is the short answer.
 *
 * ## Normalization: separating intended changes from real ones
 *
 * Most raw differences are changes we chose to make, so comparing verbatim
 * buries the interesting cases. Each intended change is a `NORMALIZERS` entry —
 * a prose rule plus a transform that rewrites the *baseline* to follow this
 * copy's rule. With normalizers on (the default), whatever still differs is a
 * **real** difference, reported under "REAL DIFFERENCES" and labelled by
 * `residual`.
 *
 * Changes that alter how the input is carved up (rather than how a chunk is
 * reported) cannot be undone from chunk output — those are catalogued in
 * `NON_NORMALIZABLE` and explain every surviving residual. `--explain` prints
 * both catalogues; `--raw` turns normalization off.
 *
 * Deliberately not wired into `npm run check` — it takes minutes and its first
 * run reaches the network. `npm test` globs `test/*.test.js`, so the runner
 * skips this file, and `files` in package.json lists only `src` and `dist`, so
 * it is never published.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { split as splitNew, getChunk as getChunkNew } from "../src/index.js";
import tiktoken from "tiktoken";

// ----- Baseline -----------------------------------------------------------

const BASELINE_VERSION = "0.2.0";
const BASELINE_DIR = new URL(
  `./.cache/llm-splitter-${BASELINE_VERSION}/`,
  import.meta.url,
);

/**
 * SHA-256 of each published file, as shipped in the npm tarball (jsDelivr
 * serves those bytes verbatim). Pinned because this executes downloaded code,
 * and because a benchmark whose baseline can change underneath it measures
 * nothing. Regenerate with:
 *
 *     npm pack llm-splitter@<version> && tar xzf llm-splitter-<version>.tgz
 *     shasum -a 256 package/dist/{index,split,get-chunk}.js
 */
const BASELINE_FILES = {
  "index.js":
    "9e3af65e455cf8020ebf048be805e0775a9f0e1116807871a3d56f2f74aa5b10",
  "split.js":
    "71841e06d9316892a5025efa0c33caf641e36e6b3bc9d97633e7ee60f774b92f",
  "get-chunk.js":
    "52782ff072ae5dd24674e9b8a5c32955b13c6eed3001638a949c71a5f7e06735",
};

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Fetch one baseline file into the cache unless a byte-correct copy is already
 * there. Verifying the cached copy (rather than just checking existence) means
 * a truncated or hand-edited cache self-heals on the next run.
 *
 * @param {string} name
 * @param {string} digest
 */
const cacheBaselineFile = async (name, digest) => {
  const dest = new URL(name, BASELINE_DIR);
  try {
    if (sha256(await readFile(dest)) === digest) {
      return;
    }
  } catch {
    // Not cached yet, or unreadable — fall through and fetch.
  }

  const url = `https://cdn.jsdelivr.net/npm/llm-splitter@${BASELINE_VERSION}/dist/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== digest) {
    throw new Error(
      `digest mismatch for ${name}\n  expected ${digest}\n  actual   ${actual}`,
    );
  }
  await writeFile(dest, bytes);
};

/**
 * Resolve the published baseline without a sibling checkout or a
 * devDependency. `llm-splitter@0.2.0` publishes three dependency-free ESM
 * files that import each other by relative path, so caching them side by side
 * is all it takes to make `index.js` importable.
 *
 * Fetching beats the alternatives here: a `npm:` alias devDependency would put
 * the package's own former self in its manifest (and, once an `exports` map
 * lands, an unaliased one would silently self-resolve and make the benchmark
 * compare this copy against itself), while vendoring commits 15KB of someone
 * else's build output. The cache is gitignored, so a clean clone stays clean.
 */
const loadBaseline = async () => {
  await mkdir(BASELINE_DIR, { recursive: true });
  try {
    await Promise.all(
      Object.entries(BASELINE_FILES).map(([name, digest]) =>
        cacheBaselineFile(name, digest),
      ),
    );
  } catch (err) {
    throw new Error(
      `Could not resolve the published llm-splitter@${BASELINE_VERSION} baseline.\n` +
        `It downloads once into ${BASELINE_DIR.pathname} and is reused offline after that,\n` +
        `so the first run needs network access. Behind a proxy, Node.js ignores\n` +
        `HTTPS_PROXY for fetch() unless you set NODE_USE_ENV_PROXY=1.`,
      { cause: err },
    );
  }
  return import(new URL("index.js", BASELINE_DIR).href);
};

const { split: splitOld, getChunk: getChunkOld } = await loadBaseline();

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

/** Two decimals and an "x", so thresholds and measurements read alike. */
/** @param {number} value */
const fmtRatio = (value) =>
  Number.isFinite(value) ? `${value.toFixed(2)}x` : "n/a";

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
 * as a transform that removes it from the comparison. Whatever still differs
 * after all of them is a real difference — an unintended regression, or a
 * change nobody wrote down.
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
      `${paint(ANSI.green, `faster (<=${fmtRatio(RATIO_FASTER)})`)}  ` +
      `${paint(ANSI.orange, `slower (>${fmtRatio(RATIO_NOISE_BAND)})`)}  ` +
      `${paint(ANSI.red, `much slower (>=${fmtRatio(RATIO_MUCH_SLOWER)})`)}`,
  );
  console.log(
    `${paint(ANSI.dim, "diff ")}` +
      `${paint(ANSI.orange, "versions disagree")}  ` +
      `${paint(ANSI.dim, "expected by design")}  ` +
      `${paint(ANSI.red, "broken contract / lost text")}`,
  );
}

// ----- summary ------------------------------------------------------------

/**
 * @param {ScenarioRecord[]} list
 * @param {(r: ScenarioRecord) => number} pick
 */
const sum = (list, pick) => list.reduce((acc, r) => acc + pick(r), 0);

/**
 * Count scenarios by some attribute, most frequent first. Says *where* a set
 * of scenarios lives, not just how many there are — a regression confined to
 * one splitter reads very differently from one spread across the matrix.
 *
 * @param {ScenarioRecord[]} list
 * @param {(r: ScenarioRecord) => string} key
 */
const tally = (list, key) => {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of list) {
    const k = key(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} (${n})`)
    .join(", ");
};

/** The same ratio, said the way a person would say it. @param {number} ratio */
const speedPhrase = (ratio) => {
  if (!Number.isFinite(ratio)) {
    return "no timings";
  }
  if (ratio <= RATIO_FASTER) {
    return `${(1 / ratio).toFixed(2)}x faster`;
  }
  if (ratio > RATIO_NOISE_BAND) {
    return `${ratio.toFixed(2)}x slower`;
  }
  return "about the same";
};

const LABEL_WIDTH = 24;
/** @param {string} label @param {string} value */
const stat = (label, value) =>
  console.log(`  ${label.padEnd(LABEL_WIDTH)} ${value}`);

// Read ratios off the records, not the table rows — the rendered cells may
// carry color escapes. A scenario fast enough to measure 0ms yields a
// non-finite ratio, so bucket only the ones that produced a real number.
const ok = records.filter((r) => !r.error);
const timed = ok.filter((r) => Number.isFinite(r.ratio));
const validRatios = timed.map((r) => r.ratio).sort((a, b) => a - b);
const medianRatio = validRatios.length ? median(validRatios) : NaN;
const worstRatio = validRatios.length
  ? validRatios[validRatios.length - 1]
  : NaN;
const bestRatio = validRatios.length ? validRatios[0] : NaN;

// Same thresholds the table colors by, so a count here always matches the
// number of cells of that color above.
const faster = timed.filter((r) => r.ratio <= RATIO_FASTER);
const evenlyMatched = timed.filter(
  (r) => r.ratio > RATIO_FASTER && r.ratio <= RATIO_NOISE_BAND,
);
const slower = timed.filter(
  (r) => r.ratio > RATIO_NOISE_BAND && r.ratio < RATIO_MUCH_SLOWER,
);
const muchSlower = timed.filter((r) => r.ratio >= RATIO_MUCH_SLOWER);
const regressions = [...timed]
  .filter((r) => r.ratio > RATIO_NOISE_BAND)
  .sort((a, b) => b.ratio - a.ratio);

const differing = records.filter(
  (r) => !r.error && (r.raw.countDiff || r.raw.posDiff || r.raw.endOnlyDiff),
);
const unexplained = records.filter((r) => !r.error && r.residual);
const identical = ok.filter(
  (r) =>
    !r.raw.countDiff && !r.raw.posDiff && !r.raw.endOnlyDiff && !r.raw.textDiff,
);

const oldUncovered = sum(
  ok,
  (r) => r.oldCoverage.internal + r.oldCoverage.tail,
);
const newUncovered = sum(
  ok,
  (r) => r.newCoverage.internal + r.newCoverage.tail,
);
const oldUncoveredIn = ok.filter(
  (r) => r.oldCoverage.internal || r.oldCoverage.tail,
).length;
const newUncoveredIn = ok.filter(
  (r) => r.newCoverage.internal || r.newCoverage.tail,
).length;
const oldBroken = sum(ok, (r) => r.oldContractViolations);
const newBroken = sum(ok, (r) => r.newContractViolations);

// chunk-end and text-only mean a chunk this copy emits disagrees with the
// baseline in a way no documented decision covers — the red residuals.
const brokenResiduals = ok.filter(
  (r) => r.residual === "chunk-end" || r.residual === "text-only",
);

console.log("");
console.log("=".repeat(78));
console.log(
  `${paint(ANSI.bold, "SUMMARY")}  ${scenarios.length} scenarios  ·  ` +
    `median ${paintByRatio(medianRatio, fmtRatio(medianRatio))}  ·  ` +
    (unexplained.length
      ? paint(ANSI.orange, `${unexplained.length} real differences`)
      : paint(ANSI.green, "no real differences")) +
    "  ·  " +
    (totalErrors ? paint(ANSI.red, `${totalErrors} errors`) : "0 errors"),
);
console.log("=".repeat(78));

// ----- summary: performance -----------------------------------------------

console.log("");
console.log(
  paint(ANSI.bold, "PERFORMANCE") +
    paint(
      ANSI.dim,
      "   ratio = newMs / oldMs; under 1.00x is this copy winning",
    ),
);
stat(
  "typical scenario",
  `${fmtRatio(medianRatio)}  ${paintByRatio(medianRatio, speedPhrase(medianRatio))}`,
);
stat(
  "range",
  `best ${paintByRatio(bestRatio, fmtRatio(bestRatio))}  ·  ` +
    `worst ${paintByRatio(worstRatio, fmtRatio(worstRatio))}`,
);
stat(
  "faster",
  `${faster.length ? paint(ANSI.green, faster.length) : faster.length} ` +
    paint(ANSI.dim, `(<= ${fmtRatio(RATIO_FASTER)})`),
);
stat(
  "no real change",
  `${evenlyMatched.length} ` +
    paint(
      ANSI.dim,
      `(inside the ${fmtRatio(RATIO_NOISE_BAND)} noise band — call it a tie)`,
    ),
);
stat(
  "slower",
  `${paintSeverity(slower.length, { warn: slower.length > 0 })} ` +
    paint(ANSI.dim, `(> ${fmtRatio(RATIO_NOISE_BAND)})`),
);
stat(
  "much slower",
  `${paintSeverity(muchSlower.length, { bad: muchSlower.length > 0 })} ` +
    paint(ANSI.dim, `(>= ${fmtRatio(RATIO_MUCH_SLOWER)} — the red threshold)`),
);

if (regressions.length) {
  // Every red scenario gets named, however many there are; the merely-slower
  // ones are truncated because the ratio column already lists them.
  const SLOWEST_SHOWN = 5;
  const shown = regressions.slice(
    0,
    Math.max(SLOWEST_SHOWN, muchSlower.length),
  );
  const width = Math.max(...shown.map((r) => r.label.length));

  console.log("");
  console.log(`  ${paint(ANSI.bold, "where this copy is slower")}`);
  for (const r of shown) {
    const delta = r.newMs - r.oldMs;
    console.log(
      `    ${paintByRatio(r.ratio, fmtRatio(r.ratio).padStart(6))}  ` +
        `${r.label.padEnd(width)}  ` +
        paint(
          ANSI.dim,
          `${r.oldMs.toFixed(2)} -> ${r.newMs.toFixed(2)}ms ` +
            `(${delta >= 0 ? "+" : ""}${delta.toFixed(2)}ms)`,
        ),
    );
  }
  if (regressions.length > shown.length) {
    console.log(
      paint(
        ANSI.dim,
        `    ... and ${regressions.length - shown.length} more above ${fmtRatio(RATIO_NOISE_BAND)}`,
      ),
    );
  }

  console.log("");
  stat(
    "slower cases cluster in",
    tally(regressions, (r) => r.corpus),
  );
  stat(
    "",
    tally(regressions, (r) => r.size),
  );
  stat(
    "",
    tally(regressions, (r) => r.splitter),
  );
  stat(
    "",
    tally(regressions, (r) => r.strategy),
  );

  // A 2x on a scenario that takes 40 microseconds is not the same finding as a
  // 2x on one that takes a second, and the ratio alone cannot tell them apart.
  const trivial = regressions.filter((r) => r.newMs - r.oldMs < 0.5);
  if (trivial.length) {
    console.log("");
    console.log(
      paint(
        ANSI.dim,
        `  ${trivial.length} of those ${regressions.length} cost under +0.5ms in absolute terms.`,
      ),
    );
    console.log(
      paint(
        ANSI.dim,
        "  Read the delta alongside the ratio before calling one a regression.",
      ),
    );
  }
}

// ----- summary: correctness ----------------------------------------------

console.log("");
console.log(
  paint(ANSI.bold, "CORRECTNESS") +
    paint(ANSI.dim, "   chunk-for-chunk against the published library"),
);
stat("identical", `${identical.length} / ${ok.length} scenarios`);
stat(
  "differing (raw)",
  `${differing.length} / ${ok.length}  →  ` +
    `${differing.length - unexplained.length} explained by normalizers, ` +
    (unexplained.length
      ? paint(ANSI.orange, `${unexplained.length} real`)
      : paint(ANSI.green, "0 real")),
);
if (unexplained.length) {
  const byReason = ["chunk-count", "anchor-drift", "chunk-end", "text-only"]
    .map((reason) => ({
      reason,
      n: ok.filter((r) => r.residual === reason).length,
    }))
    .filter((x) => x.n)
    .map((x) =>
      paintSeverity(`${x.reason} ${x.n}`, {
        bad: x.reason === "chunk-end" || x.reason === "text-only",
        warn: x.reason === "chunk-count" || x.reason === "anchor-drift",
      }),
    );
  stat("real differences are", byReason.join(", "));
  stat(
    "",
    tally(unexplained, (r) => r.corpus),
  );
}
stat(
  "text lost by this copy",
  `${paintSeverity(newUncovered, { bad: newUncovered > 0 })} code units ` +
    `in ${newUncoveredIn} scenarios`,
);
stat(
  "text lost by baseline",
  paint(
    oldUncovered ? ANSI.orange : ANSI.dim,
    `${oldUncovered} code units in ${oldUncoveredIn} scenarios`,
  ) + paint(ANSI.dim, "   (what coverage-extension fixes)"),
);
stat(
  "text != getChunk()",
  `old=${paintSeverity(oldBroken, { bad: oldBroken > 0 })} ` +
    `new=${paintSeverity(newBroken, { bad: newBroken > 0 })} chunks`,
);

// ----- summary: verdict ---------------------------------------------------

/** @type {string[]} */
const verdict = [];

if (totalErrors) {
  verdict.push(
    paint(
      ANSI.red,
      `✗ ${totalErrors} scenario(s) threw — see the ERR rows and the ERROR lines above`,
    ),
  );
}
if (muchSlower.length) {
  // Name the red ones outright — this is the finding a reader must not miss,
  // and a bare count sends them hunting through 270 rows for it.
  const NAMED = 2;
  const named = [...muchSlower]
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, NAMED)
    .map((r) => `      ${fmtRatio(r.ratio)}  ${r.label}`)
    .join("\n");
  verdict.push(
    paint(
      ANSI.red,
      `✗ ${muchSlower.length} scenario(s) at or past ${fmtRatio(RATIO_MUCH_SLOWER)} slower — over the red threshold\n` +
        named +
        (muchSlower.length > NAMED
          ? `\n      ... and ${muchSlower.length - NAMED} more`
          : ""),
    ),
  );
}
if (slower.length) {
  verdict.push(
    paint(
      ANSI.orange,
      `! ${slower.length} scenario(s) slower than ${fmtRatio(RATIO_NOISE_BAND)} but under the red threshold`,
    ),
  );
}
if (!slower.length && !muchSlower.length) {
  verdict.push(
    paint(ANSI.green, `✓ nothing measurably slower than the baseline`),
  );
}
verdict.push(
  newUncovered
    ? paint(
        ANSI.red,
        `✗ this copy leaves ${newUncovered} code unit(s) attributed to no chunk — the coverage invariant is broken`,
      )
    : paint(ANSI.green, "✓ no source text lost: the coverage invariant holds"),
);
verdict.push(
  newBroken || oldBroken
    ? paint(
        ANSI.red,
        `✗ chunk text disagrees with its own start/end (old=${oldBroken} new=${newBroken})`,
      )
    : paint(ANSI.green, "✓ every chunk's text matches its own start/end"),
);
if (brokenResiduals.length) {
  verdict.push(
    paint(
      ANSI.red,
      `✗ ${brokenResiduals.length} scenario(s) differ in a way no decision explains (chunk-end / text-only)`,
    ),
  );
}
verdict.push(
  unexplained.length
    ? paint(
        ANSI.orange,
        `! ${unexplained.length} scenario(s) still differ after normalization — run --diff to read them`,
      )
    : paint(
        ANSI.green,
        "✓ every difference is accounted for by a documented normalizer",
      ),
);

console.log("");
console.log(paint(ANSI.bold, "VERDICT"));
for (const v of verdict) {
  console.log(`  ${v}`);
}
console.log("");
console.log(
  paint(
    ANSI.dim,
    activeNormalizers.length
      ? `(normalizers: ${activeNormalizers.join(", ")} — see --explain)`
      : "(no normalizers: raw comparison)",
  ),
);

// ----- diff report --------------------------------------------------------

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
    await writeFile(args.diffJson, payload);
    console.log(`\nWrote ${args.diffJson}`);
  } else {
    console.log(payload);
  }
}

tt.free();
