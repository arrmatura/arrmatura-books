/**
 * Pandoc: the structural check on the assembled file, and the two renders.
 *
 * Every pandoc call runs with cwd ROOT, the content repo. The assembled markdown names
 * two kinds of image, both relative to ROOT, which is the --resource-path: the content
 * repo's own (rewriteLinks) and the generated diagrams in build/diagrams/.
 * LaTeX's \includegraphics of the cover is not resolved through it: xelatex runs in
 * pandoc's working directory, which is why the cover path is relative to ROOT.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CODE_BREAKS, EPUB_CSS, ROOT, type Site, TABLE_RULES, TABLE_WIDTHS, warn } from "./context";

// A bare '---' in the book is a horizontal rule, never metadata.
// normalizeThematicBreaks removes the other readings; this removes the one it cannot.
const PANDOC_READER = "markdown-yaml_metadata_block";

const DECLARED_ID_RE = /^#{1,6}\s.*\{#([^}\s]+)[^}]*\}\s*$/gm;

const TABLE_PADDING = "\\renewcommand{\\arraystretch}{1.3}" + "\\setlength{\\extrarowheight}{2pt}";

// Long inline code is given breakpoints by book/code-breaks.lua, not here: a
// preamble redefinition of \texttt through seqsplit fails on the escapes pandoc
// writes for a caret or a brace.
//
// Comparison tables carry prose in four columns, so a step down inside a table keeps
// them on the measure without shrinking the body text.
//
// Those same four-column tables wrap one row to three or four lines, so rows need
// separating or they run together. Each gets a little vertical padding and a hairline
// above it, drawn at a quarter black so a long table reads as banded rather than as a
// grid. The rules themselves come from book/table-rules.lua, which is the only place
// they can come from — see that file. Padding is deliberately modest: at the 1.45
// arraystretch that reads best on its own, the book grows by twenty-two pages.
//
// Blockquotes in this book are asides: a rule of thumb, a caution, a line worth
// stopping on. Pandoc sets them as an indented paragraph, which at 11pt on a 15.4cm
// measure reads as body text that has drifted right. Each becomes a callout instead —
// warm paper, with an amber bar down the left edge, so it is visibly not the argument
// it interrupts.
//
// mdframed rather than framed's snugshade, on two counts: snugshade takes its colour
// from `shadecolor`, which pandoc's highlighting already owns for code blocks, and it
// draws no rule. mdframed's default style breaks across a page, which a long quote
// needs.
const PDF_CALLOUT =
  "\\usepackage{mdframed}" +
  "\\definecolor{bookcalloutback}{HTML}{FAF4E8}" +
  "\\definecolor{bookcalloutrule}{HTML}{EFAE16}" +
  "\\newmdenv[backgroundcolor=bookcalloutback,linecolor=bookcalloutrule," +
  "linewidth=3pt,topline=false,bottomline=false,rightline=false," +
  "innerleftmargin=12pt,innerrightmargin=12pt,innertopmargin=9pt," +
  "innerbottommargin=9pt,skipabove=0.9\\baselineskip,skipbelow=0.9\\baselineskip," +
  "leftmargin=0pt,rightmargin=0pt]{bookcallout}" +
  "\\renewenvironment{quote}{\\begin{bookcallout}}{\\end{bookcallout}}";

// Glossaries are definition lists, which LaTeX sets run-in: the term in bold at the
// left margin, its definition alongside, the rest of it hung underneath. That is how a
// printed glossary reads and it needs no help. What does need help is a definition
// holding a bulleted list — LaTeX gives a nested itemize a left margin of its own on
// top of the description's, so the bullets land a long way right of the definition they
// belong to and read as a separate block. The margin is narrowed for that nesting only,
// inside the description environment, so every other list in the book is untouched.
const PDF_DEFINITION_LIST =
  "\\usepackage{enumitem}" + "\\AtBeginEnvironment{description}{\\setlist[itemize]{leftmargin=1.2em}}";

// Maths symbols that neither PDF_MAIN_FONT nor PDF_MONO_FONT carries, set in DejaVu
// Sans instead, so they print rather than drop. No one monospace font has them all.
// DejaVu ships with TeX Live, so it is there wherever xelatex is. A new symbol that
// drops shows in the build log as "Missing character": add it here.
//
// XeTeX character classes rather than newunicodechar: that makes each symbol an
// active character, and unicode-math redefines the active n-ary ones (⋀ ⋁ ⋂ ⋃) as
// math operators, which then fail in text. A class switches the font around a run of
// these symbols, in text only, and leaves maths alone. 4095 is the boundary class.
const PDF_FALLBACK_CHARS = "⇒⊢⊤⊥⋀⋁⋂⋃∖∣⟹⟺ℝₖₙ";
const hex = (char: string) => (char.codePointAt(0) ?? 0).toString(16).toUpperCase();
// biome-ignore format: one preamble line per command
const PDF_FALLBACK_FONT =
  "\\newfontfamily\\bookfallback{DejaVuSans.ttf}" +
  "\\XeTeXinterchartokenstate=1" +
  "\\newXeTeXintercharclass\\bookfallbackclass" +
  [...PDF_FALLBACK_CHARS].map((char) => `\\XeTeXcharclass"${hex(char)}=\\bookfallbackclass`).join("") +
  "\\XeTeXinterchartoks 0 \\bookfallbackclass={\\begingroup\\bookfallback}" +
  "\\XeTeXinterchartoks 4095 \\bookfallbackclass={\\begingroup\\bookfallback}" +
  "\\XeTeXinterchartoks \\bookfallbackclass 0={\\endgroup}" +
  "\\XeTeXinterchartoks \\bookfallbackclass 4095={\\endgroup}";

// biome-ignore format: one preamble line per command
const PDF_HEADER_INCLUDES =
  "header-includes=" +
  "\\usepackage{etoolbox}" +
  "\\usepackage{colortbl}" +
  "\\AtBeginEnvironment{longtable}{\\small" + TABLE_PADDING + "}" +
  "\\AtBeginEnvironment{tabular}{\\small" + TABLE_PADDING + "}" +
  PDF_CALLOUT +
  PDF_DEFINITION_LIST +
  PDF_FALLBACK_FONT;

// The book uses box-drawing characters for diagrams and a few maths symbols in
// prose. TeX's default Latin Modern has none of them, so the PDF needs fonts that
// do. These two are present on macOS; if either is missing the PDF still builds,
// with glyphs dropped.
const PDF_MAIN_FONT = "Times New Roman";
const PDF_MONO_FONT = "Menlo";

/**
 * LaTeX that opens the PDF on a full-bleed cover page.
 *
 * AtBeginDocument rather than an --include-before-body file, because pandoc's
 * template puts \maketitle before the includes and the cover has to come first.
 * Margins are dropped for that one page so the photograph reaches the paper's edge,
 * and restored immediately after; the cover is A4-proportioned, so asking for both
 * the paper's width and its height does not stretch it.
 *
 * \maketitle is then emptied: the cover already carries the title, the subtitle and
 * the author, and pandoc's title page would otherwise repeat all three overleaf.
 */
function pdfCoverInclude(cover: string): string {
  return (
    "header-includes=" +
    "\\renewcommand{\\maketitle}{}" +
    "\\AtBeginDocument{" +
    "\\newgeometry{margin=0pt}" +
    "\\thispagestyle{empty}" +
    `\\noindent\\includegraphics[width=\\paperwidth,height=\\paperheight]{${cover}}` +
    "\\clearpage" +
    "\\restoregeometry}"
  );
}

/** Run a command to completion, inheriting the terminal. Throws on a nonzero exit. */
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

/**
 * Run a command and return its stdout. Throws on a nonzero exit. The buffer is
 * unbounded: verifyAnchors captures a whole book as HTML, past the 1 MB default.
 */
function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: Infinity });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}\n${result.stderr}`);
  return result.stdout;
}

/**
 * Check that pandoc sees every heading and link the assembled file declares.
 *
 * Markdown is ambiguous enough that a document can render with a zero exit code and
 * a quietly mangled structure — headings absorbed into a table, say. This renders to
 * HTML and compares what arrived against what was written.
 */
export function verifyAnchors(markdownPath: string): string[] {
  const html = capture("pandoc", [markdownPath, "--from", PANDOC_READER, "--to", "html5", "--section-divs"]);
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const declared = new Set([...markdown.matchAll(DECLARED_ID_RE)].map((match) => match[1]));
  const rendered = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const linked = new Set([...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]));
  const problems: string[] = [];
  for (const anchor of [...declared].filter((id) => !rendered.has(id)).sort()) {
    problems.push(`heading id '${anchor}' was declared but did not render`);
  }
  for (const anchor of [...linked].filter((id) => !rendered.has(id)).sort()) {
    problems.push(`link target '#${anchor}' matches no heading`);
  }
  return problems;
}

/** Write the book's metadata where pandoc's --metadata-file reads it: JSON is YAML. */
function metadataFile(site: Site): string {
  const file = path.join(site.build, "metadata.json");
  fs.writeFileSync(file, JSON.stringify(site.metadata, null, 2));
  return file;
}

/** Run pandoc for one output format. `extra` goes after the kit's own arguments for that format. */
export function render(
  site: Site,
  markdownPath: string,
  target: "epub" | "pdf",
  outPath: string,
  cover: string | null,
  extra: string[] = [],
): void {
  // biome-ignore format: each flag beside its value
  const args = [
    markdownPath,
    "--from", PANDOC_READER,
    "--toc", "--toc-depth=2",
    "--resource-path", ROOT,
    "--metadata-file", metadataFile(site),
    "--output", outPath,
    // Before table-rules.lua, which turns each table into raw LaTeX.
    "--lua-filter", TABLE_WIDTHS,
  ];
  if (target === "pdf") {
    // biome-ignore format: each flag beside its value
    args.push(
      "--pdf-engine", "xelatex",
      // A reading book, not a paper: chapters open on a fresh page, the folder is
      // the chapter, and the measure is wide enough for four-column tables.
      "--top-level-division=chapter",
      "-V", "documentclass=book",
      "-V", "classoption=oneside",
      "-V", "papersize=a4",
      "-V", "geometry=top=2.5cm",
      "-V", "geometry=bottom=2.5cm",
      "-V", "geometry=left=2.8cm",
      "-V", "geometry=right=2.8cm",
      "-V", "fontsize=11pt",
      "-V", "linestretch=1.15",
      "-V", "colorlinks=true",
      "-V", "linkcolor=RoyalBlue",
      "-V", PDF_HEADER_INCLUDES,
      // table-rules.lua hands each table back as a raw block, so pandoc stops seeing
      // a table in the document and its template stops loading longtable and
      // booktabs. This says to load them anyway.
      "--lua-filter", TABLE_RULES, "--lua-filter", CODE_BREAKS,
      "-V", "tables=true",
      ...extra,
    );
    // A second -V of the same name: pandoc collects them, so this joins
    // PDF_HEADER_INCLUDES in the preamble rather than replacing it.
    if (cover) args.push("-V", pdfCoverInclude(cover));
    const fonts = ["-V", `mainfont=${PDF_MAIN_FONT}`, "-V", `monofont=${PDF_MONO_FONT}`];
    if (spawnSync("pandoc", [...args, ...fonts], { cwd: ROOT, stdio: "inherit" }).status === 0) return;
    warn(
      `  warning: ${PDF_MAIN_FONT}/${PDF_MONO_FONT} unavailable, falling back to the TeX default; ` +
        "diagram characters will be missing",
    );
  } else {
    // --css REPLACES pandoc's default EPUB stylesheet rather than adding to it, which
    // would drop the book's baseline typography. So ask pandoc for its own default
    // and layer ours on top: two --css arguments are embedded and linked in order,
    // and this keeps the default in step with whatever pandoc is installed rather
    // than vendoring a copy that goes stale.
    const defaultCss = path.join(site.build, "epub-default.css");
    fs.writeFileSync(defaultCss, capture("pandoc", ["--print-default-data-file", "epub.css"]));
    args.push("--to", "epub3", "--split-level=1", "--css", defaultCss, "--css", EPUB_CSS, ...extra);
    if (cover) args.push("--epub-cover-image", cover);
  }
  run("pandoc", args);
}
