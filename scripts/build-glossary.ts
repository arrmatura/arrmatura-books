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
// term is one key, as written; the reader resolves other spellings with `glossaryDefinition`.

import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "./check-glossary";
import { splitLines } from "./utils/splitLines";

const GLOSSARY_FILE = "www/glossary.json";
const RELATIVE_LINK_RE = /\[([^\]]+)\]\((?!https?:)[^)]*\)/g;

/** The markdown of the definition opening at `start`: its first line and its indented blocks. */
function definitionAt(lines: string[], start: number): string {
  const body = [lines[start].replace(/^:\s+/, "")];
  for (let index = start + 1; index < lines.length && /^(\s|$)/.test(lines[index]); index++) {
    body.push(lines[index].replace(/^ {1,4}/, ""));
  }
  return body.join("\n").trimEnd().replace(RELATIVE_LINK_RE, "$1");
}

function main(paths: string[]) {
  const glossary: Record<string, string> = {};
  const sources = new Map<string, string>();

  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    const lines = splitLines(text);
    for (const { term, line } of parse(text).rows) {
      const source = sources.get(term);
      if (source) {
        console.log(`  - '${term}': kept ${source}, dropped ${path}:${line}`);
        continue;
      }
      sources.set(term, `${path}:${line}`);
      glossary[term] = definitionAt(lines, line - 1);
    }
  }

  writeFileSync(GLOSSARY_FILE, `${JSON.stringify(glossary, null, 2)}\n`);
  console.log(`✅ ${sources.size} terms of ${paths.length} files -> ${GLOSSARY_FILE}`);
}

main(process.argv.slice(2));
