/// <reference types="node" />
// Validates relative links and heading anchors in a content repo's docs. Run in the content repo,
// as its `npm run check:links`:
//
//   git ls-files 'docs/*.md' | xargs bun ../arrmatura-books/scripts/check-links.ts
//
// It reads the files it is given plus their link targets, so a broken link is caught when the
// referring file is checked, not when only the renamed heading's file is.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { splitLines } from "./utils/splitLines";

const LINK_RE = /(?<bang>!?)\[(?<text>[^[\]]*)\]\((?<target>[^()]*)\)/g;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const HEADING_RE = /^(?<level>#{1,6})\s+(?<title>.+?)\s*$/;
const INLINE_LINK_RE = /!?\[(?<text>[^[\]]*)\]\([^()]*\)/g;
// Python's `\w`: any letter, number or underscore.
const UNSLUGGABLE_RE = /[^\p{L}\p{N}_\- ]/gu;
const FENCE_RE = /^ {0,3}(?<marker>`{3,}|~{3,})\s*(?<info>.*)$/;

const anchorCache = new Map<string, string[]>();

/**
 * Every line outside a fenced code block, with its 1-based number.
 *
 * Several docs show markdown samples containing '#' lines and bracket syntax; those are neither
 * headings nor links. A fence closes only on a marker of the same character that is at least as
 * long as the one that opened it, so a '~~~' inside a '```' block is ordinary content.
 */
function* proseLines(text: string): Generator<[number, string]> {
  let fence: string | null = null;
  for (const [index, line] of splitLines(text).entries()) {
    const match = FENCE_RE.exec(line);
    if (fence === null) {
      if (match) {
        fence = match.groups?.marker as string;
        continue;
      }
    } else {
      const marker = match?.groups?.marker;
      const closes = marker && marker[0] === fence[0] && marker.length >= fence.length && !match?.groups?.info.trim();
      if (closes) fence = null;
      continue;
    }
    yield [index + 1, line];
  }
}

/** Drops the markup a renderer would not put in the heading's text. */
const stripInlineMarkdown = (title: string) =>
  title
    .replace(INLINE_LINK_RE, (_, text) => text)
    .replace(/\*/g, "")
    .replace(/`/g, "");

/**
 * The anchor GitHub generates for a heading.
 *
 * Lowercase the text, drop every character that is not a word character, a space, or a hyphen,
 * then replace spaces with hyphens. Dropping a character leaves the spaces around it behind, so
 * 'Violations & Smells' becomes 'violations--smells'.
 */
const slugify = (title: string) =>
  stripInlineMarkdown(title).trim().toLowerCase().replace(UNSLUGGABLE_RE, "").replace(/ /g, "-");

/**
 * Every anchor a reader can jump to in `path`, in document order.
 *
 * Repeated headings collide, and GitHub disambiguates them by appending '-1', '-2' and so on to
 * every occurrence after the first.
 */
function headingAnchors(path: string): string[] {
  const key = realpathSync(path);
  const cached = anchorCache.get(key);
  if (cached) return cached;

  const anchors: string[] = [];
  const seen = new Map<string, number>();
  for (const [, line] of proseLines(readFileSync(path, "utf8"))) {
    const heading = HEADING_RE.exec(line);
    if (!heading) continue;
    const slug = slugify(heading.groups?.title as string);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.push(count === 0 ? slug : `${slug}-${count}`);
  }

  anchorCache.set(key, anchors);
  return anchors;
}

/** Strips an optional link title, leaving the destination. */
const destination = (target: string) => target.trim().split(/\s+/)[0];

/** Decodes `%XX` escapes like Python's `unquote`: a malformed one is left as written. */
const unquote = (text: string) =>
  text.replace(/(?:%[0-9a-f]{2})+/gi, (escapes) => {
    try {
      return decodeURIComponent(escapes);
    } catch {
      return escapes;
    }
  });

function checkFile(path: string): string[] {
  const errors: string[] = [];
  for (const [lineno, line] of proseLines(readFileSync(path, "utf8"))) {
    for (const match of line.matchAll(LINK_RE)) {
      if (match.groups?.bang) continue;
      const target = destination(match.groups?.target as string);
      if (!target || EXTERNAL_RE.test(target)) continue;

      const hash = target.indexOf("#");
      const relative = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? "" : target.slice(hash + 1);

      let resolved = path;
      if (relative) {
        resolved = resolve(dirname(path), unquote(relative));
        if (!existsSync(resolved)) {
          errors.push(`${path}:${lineno}: link target does not exist: ${target}`);
          continue;
        }
      }

      if (!anchor || !resolved.endsWith(".md")) continue;
      if (!headingAnchors(resolved).includes(unquote(anchor))) {
        errors.push(`${path}:${lineno}: no heading in ${basename(resolved)} generates the anchor '#${anchor}'`);
      }
    }
  }
  return errors;
}

function main(paths: string[]): number {
  const errors = paths.flatMap(checkFile);
  if (!errors.length) return 0;

  console.log("Link check failed:\n");
  for (const error of errors) console.log(`  - ${error}`);
  const files = new Set(errors.map((error) => error.split(":", 1)[0])).size;
  console.log(`\n${errors.length} issue(s) in ${files} of ${paths.length} file(s) checked.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
