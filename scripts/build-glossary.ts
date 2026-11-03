/// <reference types="node" />
// Writes a content repo's glossary, www/glossary.json: every definition-list term in its docs (see
// check-glossary.ts for the syntax), mapped to its definition as markdown. Run in the content repo,
// as its `npm run glossary`:
//
//   git ls-files 'docs/*.md' | xargs bun ../arrmatura-books/scripts/build-glossary.ts
//
// A term defined in several files keeps its first definition in the given order, so the earliest
// chapter wins; each one dropped prints as a note. Relative links are reduced to their text, since
// they resolve against the defining file and not against the page that shows the definition. Each
// term is one key, as written, holding its `definition` and its `labels`: the other spellings of it
// that the docs write as a code span, so the reader, `glossaryDefinition`, only matches text.

import { readFileSync, writeFileSync } from "node:fs";
import type { Glossary } from "../src/glossary";
import { parse } from "./check-glossary";
import { splitLines } from "./utils/splitLines";

const GLOSSARY_FILE = "www/glossary.json";
const RELATIVE_LINK_RE = /\[([^\]]+)\]\((?!https?:)[^)]*\)/g;
const CODE_SPAN_RE = /`([^`\n]+)`/g;

/** The markdown of the definition opening at `start`: its first line and its indented blocks. */
function definitionAt(lines: string[], start: number): string {
  const body = [lines[start].replace(/^:\s+/, "")];
  for (let index = start + 1; index < lines.length && /^(\s|$)/.test(lines[index]); index++) {
    body.push(lines[index].replace(/^ {1,4}/, ""));
  }
  return body.join("\n").trimEnd().replace(RELATIVE_LINK_RE, "$1");
}

/** The singular of `word`, by spelling alone: `Goals` -> `Goal`, `Weaknesses` -> `Weakness`, `Success` and `Bias` stay. */
function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  return /[^suia]s$/.test(word) ? word.slice(0, -1) : word;
}

/** The plural of a singular `word`, by spelling alone: `Policy` -> `Policies`, `Process` -> `Processes`. */
function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * Every other spelling of `term`: its singular or plural, or, for an `A (B)` or `A/B` term, each
 * name it goes by in both — `Identity Provider (IdP)` -> `Identity Provider`, `Identity Providers`, `IdP`, `IdPs`.
 */
function labelsOf(term: string): string[] {
  const names = (term.match(/^(.+?)\s*\((.+)\)$/)?.slice(1) ?? [term])
    .flatMap((name) => name.split(/\s*\/\s*/))
    .map((name) => name.replaceAll("`", ""));
  const forms = names.flatMap((name) => [name, singular(name) === name ? plural(name) : singular(name)]);
  return [...new Set(forms)].filter((form) => form !== term);
}

function main(paths: string[]) {
  const glossary: Glossary = {};
  const sources = new Map<string, string>();
  const texts = paths.map((path) => readFileSync(path, "utf8"));
  const spans = new Set(texts.flatMap((text) => [...text.matchAll(CODE_SPAN_RE)].map(([, span]) => span)));

  for (const [index, path] of paths.entries()) {
    const text = texts[index];
    const lines = splitLines(text);
    for (const { term, line } of parse(text).rows) {
      const source = sources.get(term);
      if (source) {
        console.log(`  - '${term}': kept ${source}, dropped ${path}:${line}`);
        continue;
      }
      sources.set(term, `${path}:${line}`);
      const labels = labelsOf(term).filter((label) => spans.has(label));
      glossary[term] = { labels, definition: definitionAt(lines, line - 1) };
    }
  }

  writeFileSync(GLOSSARY_FILE, `${JSON.stringify(glossary, null, 2)}\n`);
  console.log(`✅ ${sources.size} terms of ${paths.length} files -> ${GLOSSARY_FILE}`);
}

main(process.argv.slice(2));
