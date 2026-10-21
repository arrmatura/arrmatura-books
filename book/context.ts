/**
 * Where things live: the content repo the book is built in, and the book's inputs in it.
 *
 * The builder runs in the content repo (`npm run book` there), so ROOT is the working
 * directory. Its own pandoc filters and stylesheet sit beside this module.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The content repo's root: the working directory of `npm run book`. */
export const ROOT = process.cwd();

export const BUILD = path.join(ROOT, "build");

// Content-addressed: a diagram is named by a digest of its own source, so an
// unchanged diagram is never rendered twice.
export const DIAGRAMS = path.join(BUILD, "diagrams");

const BOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TABLE_WIDTHS = path.join(BOOK_DIR, "table-widths.lua");
export const TABLE_RULES = path.join(BOOK_DIR, "table-rules.lua");
export const CODE_BREAKS = path.join(BOOK_DIR, "code-breaks.lua");
export const EPUB_CSS = path.join(BOOK_DIR, "epub.css");

/** Pandoc's metadata for the book: package.json `book` but `coverPhoto`, over its `author`, `copyright` and `description`. */
export interface Metadata {
  title: string;
  subtitle?: string;
  author?: string;
  [field: string]: unknown; // language, rights, description, subject, identifier: pandoc's own
}

/** The book: where its markdown comes from and where its outputs go. All paths absolute. */
export interface Site {
  name: string; // package.json `name`; names the outputs
  src: string; // the content repo root
  docs: string; // src/docs, the markdown the book is made from
  build: string; // src/build
  metadata: Metadata;
  coverPhoto: string; // package.json `book.coverPhoto`, default src/book/cover.png
}

export const warn = (message: string) => console.error(message);

/** A path relative to `from`, with forward slashes, as markdown and pandoc expect. */
export const relativePosix = (from: string, to: string) => path.relative(from, to).split(path.sep).join("/");

/** The book of the content repo at ROOT, its inputs checked. Throws naming what is missing. */
export function resolveSite(): Site {
  const pkg = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkg)) throw new Error(`no package.json in ${ROOT}: run from the content repo`);
  const { name, author, copyright, description, book } = JSON.parse(fs.readFileSync(pkg, "utf8"));
  const docs = path.join(ROOT, "docs");
  if (!fs.statSync(docs, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no docs/ folder in ${ROOT}`);
  if (!book?.title) throw new Error("missing package.json `book.title`: the book's own metadata lives under `book`");
  const { coverPhoto = "cover.png", ...fields } = book;
  const metadata: Metadata = { author, rights: copyright, description, ...fields };
  fs.mkdirSync(BUILD, { recursive: true });
  return { name, src: ROOT, docs, build: BUILD, metadata, coverPhoto: path.join(ROOT, coverPhoto) };
}
