#!/usr/bin/env bun
/**
 * Assemble a content repo's markdown into one document and render it as an EPUB and a PDF.
 *
 * Node built-ins only. Pandoc does the rendering. The modules beside this one do the
 * part pandoc cannot: put the files in reading order, demote their headings so a
 * folder reads as a chapter, turn cross-document links into intra-document anchors so
 * navigation still works when many files become one (assemble.ts), and rasterize the
 * mermaid diagrams (diagrams.ts) and the cover (cover.ts), which neither output format
 * can draw.
 *
 * Run in the content repo, as its `npm run book`:
 *
 *     bun ../arrmatura-books/book/build.ts          # both formats
 *     bun ../arrmatura-books/book/build.ts --pdf    # one format
 *
 * The book takes its file name from package.json `name`: build/<name>.md, .epub, .pdf.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble, collectDocuments, type Document } from "./assemble";
import { CONTENT, DIAGRAMS, resolveSite, type Site, warn } from "./context";
import { buildCover } from "./cover";
import { resolveMermaid } from "./diagrams";
import { duplicateAnchors } from "./markdown";
import { render, verifyAnchors } from "./render";

const USAGE = `usage: npm run book -- [--epub] [--pdf] [--markdown]

  --epub       build the EPUB only
  --pdf        build the PDF only
  --markdown   assemble build/<name>.md and stop`;

interface Options {
  epub: boolean;
  pdf: boolean;
  markdownOnly: boolean;
}

/**
 * How the content repo's docs become one document, and what its book adds to pandoc.
 *
 * The kit's defaults read a plain docs tree. A repo whose pages need more — app links,
 * app tokens, a part per scope — exports any of these from `book/content.ts`, and the
 * rest stay the kit's.
 */
export interface ContentModel {
  collectDocuments(site: Site): Document[];
  assemble(documents: Document[], site: Site): string;
  /** After the kit's arguments for that format: a repeated flag wins, a `-V header-includes=` adds. */
  pandocArgs(target: "epub" | "pdf"): string[];
}

async function loadContentModel(): Promise<ContentModel> {
  const own: Partial<ContentModel> = fs.existsSync(CONTENT) ? await import(pathToFileURL(CONTENT).href) : {};
  return {
    collectDocuments: own.collectDocuments ?? collectDocuments,
    assemble: own.assemble ?? assemble,
    pandocArgs: own.pandocArgs ?? (() => []),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The flags. Exits with the usage on anything it does not know. */
function parseArgs(argv: string[]): Options | null {
  const options: Options = { epub: false, pdf: false, markdownOnly: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return null;
    else if (arg === "--epub") options.epub = true;
    else if (arg === "--pdf") options.pdf = true;
    else if (arg === "--markdown") options.markdownOnly = true;
    else fail(`unknown option ${arg}\n\n${USAGE}`);
  }
  return options;
}

/** Assemble, verify and render the book. Throws on anything that stops it. */
async function buildSite(site: Site, options: Options, content: ContentModel): Promise<void> {
  const documents = content.collectDocuments(site);

  // Before the assembled file is written, so that what verifyAnchors checks and what
  // pandoc reads are the same document. --markdown renders diagrams too: they are
  // the markdown's own content, and a cache hit costs nothing.
  const { markdown, diagrams, rendered } = resolveMermaid(content.assemble(documents, site));

  const source = path.join(site.build, `${site.name}.md`);
  fs.writeFileSync(source, markdown);
  const words = markdown.split(/\s+/).filter(Boolean).length;
  console.log(`assembled ${documents.length} documents, ${words.toLocaleString("en-US")} words -> ${source}`);
  if (diagrams) {
    console.log(`  ${diagrams} mermaid diagram(s): ${rendered} rendered, ${diagrams - rendered} cached -> ${DIAGRAMS}`);
  }

  for (const slug of duplicateAnchors(markdown)) warn(`  warning: heading slug '${slug}' occurs more than once`);

  const problems = verifyAnchors(source);
  for (const problem of problems) warn(`  error: ${problem}`);
  if (problems.length) throw new Error(`${problems.length} structural problem(s); not rendering`);
  console.log("  structure verified: every heading and link target resolves");

  if (options.markdownOnly) return;

  // Both formats take the same cover, so it is rendered once, before either.
  const cover = await buildCover(site);

  const both = !(options.epub || options.pdf);
  if (options.epub || both) {
    const out = path.join(site.build, `${site.name}.epub`);
    render(site, source, "epub", out, cover, content.pandocArgs("epub"));
    console.log(`wrote ${out}`);
  }
  if (options.pdf || both) {
    const out = path.join(site.build, `${site.name}.pdf`);
    render(site, source, "pdf", out, cover, content.pandocArgs("pdf"));
    console.log(`wrote ${out}`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    console.log(USAGE);
    return 0;
  }

  if (!options.markdownOnly && spawnSync("pandoc", ["--version"]).error) {
    fail("pandoc is not installed: brew install pandoc");
  }

  try {
    await buildSite(resolveSite(), options, await loadContentModel());
    return 0;
  } catch (error) {
    console.error(`  error: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
