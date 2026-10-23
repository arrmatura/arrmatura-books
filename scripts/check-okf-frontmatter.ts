/// <reference types="node" />
// Validates OKF v0.2 frontmatter on a content repo's docs (see its CLAUDE.md). Run in the content
// repo, as its `npm run check:frontmatter`:
//
//   git ls-files 'docs/*.md' | xargs bun ../arrmatura-books/scripts/check-okf-frontmatter.ts

import { readFileSync } from "node:fs";
import { splitLines } from "./utils/splitLines";

const REQUIRED_FIELDS = ["type", "title", "description", "tags"];
const BANNED_FIELDS = ["sources", "generated", "verified", "status"];
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** The frontmatter fields and the offset where the body starts, or null without a block. */
function parseFrontmatter(text: string): { fields: Record<string, string>; after: number } | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of splitLines(match[1])) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fields, after: match[0].length };
}

/** The first level-1 heading in the body outside a code fence, or null. */
function findH1(text: string, after: number): string | null {
  let fence: string | null = null;
  for (const line of splitLines(text.slice(after))) {
    const match = FENCE_RE.exec(line);
    if (match) {
      const marker = match[1][0];
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence === null && line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function checkFile(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) return [`${path}: missing OKF frontmatter block (must start with '---' ... '---')`];

  const { fields, after } = frontmatter;
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fields[field]) errors.push(`${path}: missing required field '${field}'`);
  }

  if (fields.type && fields.type !== "Guide") errors.push(`${path}: 'type' must be 'Guide', got '${fields.type}'`);

  const description = fields.description ?? "";
  const length = [...description].length;
  if (length > 140) errors.push(`${path}: 'description' is ${length} chars, keep under ~140`);

  const tagsRaw = fields.tags ?? "";
  if (tagsRaw) {
    if (!(tagsRaw.startsWith("[") && tagsRaw.endsWith("]"))) {
      errors.push(`${path}: 'tags' must be a bracketed list, got '${tagsRaw}'`);
    } else {
      const tags = tagsRaw
        .slice(1, -1)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (!tags.length) errors.push(`${path}: 'tags' list is empty`);
      for (const tag of tags) {
        if (!TAG_RE.test(tag)) errors.push(`${path}: tag '${tag}' must be lowercase, kebab-or-single-word`);
      }
    }
  }

  for (const field of BANNED_FIELDS) {
    if (field in fields) errors.push(`${path}: OKF optional field '${field}' is not used in this repo`);
  }

  const title = fields.title ?? "";
  if (title && "\"'".includes(title[0])) {
    errors.push(`${path}: 'title' must not be quoted, the quotes would print in the heading: ${title}`);
  }

  const h1 = findH1(text, after);
  if (h1 !== null) errors.push(`${path}: H1 '${h1}' found; the frontmatter title is the heading, drop the H1`);

  return errors;
}

function main(paths: string[]): number {
  const errors = paths.flatMap(checkFile);
  if (!errors.length) return 0;

  console.log("OKF frontmatter check failed:\n");
  for (const error of errors) console.log(`  - ${error}`);
  console.log(`\n${errors.length} issue(s) in ${paths.length} file(s). See CLAUDE.md for the OKF convention.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
