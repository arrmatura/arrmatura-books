/**
 * Turn a site's markdown tree into one document.
 *
 * Reading order, titles, anchors and links: the part pandoc cannot do. Put the files
 * in reading order, demote their headings so a folder reads as a chapter, and turn
 * cross-document links into intra-document anchors so navigation still works when
 * many files become one.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { relativePosix, type Site } from "./context";
import {
  addHeadingIds,
  closeVoidTags,
  normalizeThematicBreaks,
  scopeFootnotes,
  setextToAtx,
  shiftHeadings,
  slugify,
  startOnANewPage,
  topHeading,
} from "./markdown";

// Files at the root of the docs that are about the repository rather than in the book:
// the content rulebook, and a hand-written index the rendered table of contents
// replaces. Every other root file is back matter — see inReadingOrder.
const NOT_CONTENT = new Set(["CLAUDE.md", "INDEX.md"]);

const LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]*)\)/g;
const TITLE_RE = /^title:[ \t]*(.+?)[ \t]*$/m;
const EXTERNAL_PREFIXES = ["http://", "https://", "mailto:", "ftp://"];

export interface Document {
  path: string; // relative to the site's docs, posix
  title: string;
  body: string;
}

/**
 * Return the frontmatter title and the body, dropping the frontmatter block.
 *
 * Tolerant: a file with no frontmatter, or frontmatter with no title, gives a null
 * title and leaves the caller to find one — see documentTitle. An unterminated block
 * still fails, because where the body starts is then a guess. A leading byte-order mark
 * and CRLF line endings are normalized away first: left in, they would hide the
 * frontmatter, and its YAML would print as body text.
 */
export function splitFrontmatter(raw: string): { title: string | null; body: string } {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { title: null, body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) throw new Error("unterminated frontmatter");
  const title = TITLE_RE.exec(text.slice(4, end + 1));
  return {
    title: title ? title[1].replace(/^(["'])(.*)\1$/, "$2") : null,
    body: text.slice(end + "\n---\n".length).replace(/^\n+/, ""),
  };
}

/**
 * A title from a file name: `02-system-design.md` -> `System design`.
 *
 * The numeric prefix encodes reading order, not meaning, so it is dropped; and an
 * index.md is named for its folder, since "Index" says nothing.
 */
export function titleFromName(docPath: string): string {
  const parts = docPath.replace(/\.md$/i, "").split("/");
  let stem = parts.pop() ?? "";
  if (stem.toLowerCase() === "index" && parts.length) stem = parts.pop() ?? stem;
  const words =
    stem
      .replace(/^\d+[-_]/, "")
      .split(/[-_\s]+/)
      .filter(Boolean)
      .join(" ") || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The frontmatter title, else the first level-1 heading, else one made from the file name. */
export function documentTitle(docPath: string, title: string | null, body: string): string {
  return title ?? topHeading(body) ?? titleFromName(docPath);
}

/**
 * Open the body with `# title` unless it already has a level-1 heading.
 *
 * A knowledge base may keep the title in the frontmatter alone. The builder needs it
 * in the body: the level-1 heading is the document's anchor, and for a chapter opener
 * it is the \chapter itself.
 */
export function ensureTitleHeading(title: string, body: string): string {
  return topHeading(body) !== null ? body : `# ${title}\n\n${body}`;
}

/**
 * Rewrite one document's links for life inside a single assembled document.
 *
 * `source` is the document's path relative to the site's docs. A link to another
 * document becomes an anchor — its own if the link carried one, otherwise the target
 * document's title. A link to a file outside the docs (an image) becomes a path
 * relative to the content repo root, which is on pandoc's resource path.
 */
export function rewriteLinks(
  text: string,
  source: string,
  anchors: Record<string, string>,
  site: Pick<Site, "docs" | "src">,
): string {
  const sourceDir = path.dirname(path.join(site.docs, source));
  const own = () => {
    const anchor = anchors[source];
    if (anchor === undefined) throw new Error(`no anchor for ${source}`);
    return anchor;
  };
  return text.replace(LINK_RE, (whole, bang: string, label: string, target: string) => {
    if (!target || EXTERNAL_PREFIXES.some((prefix) => target.startsWith(prefix))) return whole;
    if (target.startsWith("#")) return `${bang}[${label}](#${own()}--${target.slice(1)})`;
    const hash = target.indexOf("#");
    const file = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? "" : target.slice(hash + 1);
    const resolved = path.resolve(sourceDir, file);
    if (resolved.endsWith(".md") && resolved.startsWith(site.docs + path.sep)) {
      const key = relativePosix(site.docs, resolved);
      const targetAnchor = anchors[key];
      // Kept out of the book on purpose: keep the words, drop the link.
      if (targetAnchor === undefined && NOT_CONTENT.has(path.basename(key)) && !key.includes("/")) return label;
      if (targetAnchor === undefined) throw new Error(`${source} links to unknown document ${key}`);
      return anchor ? `${bang}[${label}](#${targetAnchor}--${anchor})` : `${bang}[${label}](#${targetAnchor})`;
    }
    const relative = relativePosix(site.src, resolved);
    if (relative.startsWith("..")) return whole;
    return `${bang}[${label}](${relative})`;
  });
}

/** One unique anchor per document, keyed by its path relative to the docs. */
export function documentAnchors(documents: Document[]): Record<string, string> {
  const anchors: Record<string, string> = {};
  const taken = new Set<string>();
  for (const { path: docPath, title } of documents) {
    let candidate = slugify(title);
    if (taken.has(candidate)) candidate = `${slugify(docPath.split("/")[0])}--${candidate}`;
    for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${candidate}-${suffix}`;
    anchors[docPath] = candidate;
    taken.add(candidate);
  }
  return anchors;
}

/**
 * The root index.md, then folders in order, each led by its index.md, then any other root
 * file (quotations, a translations table) as a closing chapter.
 */
export function inReadingOrder(paths: string[]): string[] {
  const key = (docPath: string): [number, string, string] => {
    const parts = docPath.split("/");
    if (docPath === "index.md") return [0, "", ""];
    if (parts.length === 1) return [2, parts[0], ""];
    return [1, parts[0], parts[1] === "index.md" ? "" : parts[1]];
  };
  const compare = (a: [number, string, string], b: [number, string, string]) => {
    for (let i = 0; i < 3; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  return [...paths].sort((a, b) => compare(key(a), key(b)));
}

/** Every *.md under `dir`, as posix paths relative to it; a name starting with `.` or `_` is skipped. */
function markdownFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^[._]/.test(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...markdownFiles(path.join(dir, entry.name), relative));
    else if (entry.name.endsWith(".md")) files.push(relative);
  }
  return files;
}

/** Every document under the site's docs, in reading order. */
export function collectDocuments(site: Pick<Site, "docs">): Document[] {
  const paths = inReadingOrder(markdownFiles(site.docs).filter((docPath) => !NOT_CONTENT.has(docPath)));
  return paths.map((docPath) => {
    let split: ReturnType<typeof splitFrontmatter>;
    try {
      split = splitFrontmatter(fs.readFileSync(path.join(site.docs, docPath), "utf8"));
    } catch (error) {
      throw new Error(`${docPath}: ${(error as Error).message}`);
    }
    const body = setextToAtx(split.body);
    const title = documentTitle(docPath, split.title, body);
    return { path: docPath, title, body: ensureTitleHeading(title, body) };
  });
}

/**
 * One markdown document. A folder's index.md keeps its level, so it reads as the
 * chapter opener; its siblings are demoted under it. A root file is a chapter too:
 * the root index.md opens the book, the others close it.
 */
export function assemble(documents: Document[], site: Pick<Site, "docs" | "src">): string {
  const anchors = documentAnchors(documents);
  const chunks = documents.map(({ path: docPath, body }) => {
    const isChapterOpener = !docPath.includes("/") || docPath.endsWith("/index.md");
    let text = scopeFootnotes(closeVoidTags(normalizeThematicBreaks(body)), anchors[docPath]);
    text = addHeadingIds(rewriteLinks(text, docPath, anchors, site), anchors[docPath]);
    return isChapterOpener ? text : startOnANewPage(shiftHeadings(text));
  });
  return `${chunks.map((chunk) => chunk.replace(/\n+$/, "")).join("\n\n")}\n`;
}
