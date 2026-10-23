/// <reference types="node" />
// Validates glossary definition lists in a content repo's docs (see its CLAUDE.md). Run in the
// content repo, as its `npm run check:glossary`:
//
//   git ls-files 'docs/*.md' | xargs bun ../arrmatura-books/scripts/check-glossary.ts
//
// A glossary entry is a markdown definition list entry (the extended syntax at
// markdownguide.org/extended-syntax): a term alone on its line, the definition on the next line
// behind a colon, and a blank line before the next term.
//
//   Solution
//   : an artificial phenomenon a Team designs for someone outside it
//
// Definition lists are used in a book for exactly one thing, so every one of them is in scope and
// no header row is needed to mark them. Comparisons, ladders and nav tables stay tables and are not
// read here. Files with no definition list are skipped, making this safe to run over every doc.
//
// Errors (exit 1) cover the mechanically decidable rules: entries a renderer would silently fold
// together, duplicate terms, self-restating definitions, trailing periods, and pairs of terms that
// define each other. Indirect loops and oversized lists print as notes and do not fail the run. The
// remaining rules — casing of cross-references, grounding, whether a term earns its row — need
// human judgement and are deliberately not checked here.

import { readFileSync } from "node:fs";
import { splitLines } from "./utils/splitLines";

const DEFINITION_RE = /^:\s+(?<definition>.*)$/;
const HEADING_RE = /^(?<level>#{1,6})\s+(?<title>.+?)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
// A term is a bare line of prose. Anything opening a block of its own — a list item, a quote, a
// table row, a heading, an indented code line — is not one.
const NOT_A_TERM_RE = /^(\s|[-*+>|#]|\p{Nd}+\.)/u;
// The block shapes that read as a continuation of the definition above them, and so have to be
// indented into it. A heading or a table is a structure of its own and separates two entries
// legitimately, so neither is listed here.
const DETACHABLE_RE = /^([-*+>]\s|\p{Nd}+\.\s)/u;
const MAX_TERMS_PER_LIST = 12;

type Row = { term: string; definition: string; line: number };
type Finding = { line: number; message: string; note?: boolean };

/** Singular and plural spellings a definition might use to refer to `term`. */
function aliases(term: string): string[] {
  if (term.endsWith("ies")) return [term, `${term.slice(0, -3)}y`];
  if (term.endsWith("s")) return [term, term.slice(0, -1)];
  return term.endsWith("y") ? [term, `${term}s`, `${term.slice(0, -1)}ies`] : [term, `${term}s`];
}

/** Drops the inline markup that is not prose. */
const stripMarkup = (definition: string) =>
  definition.trim().replaceAll("<br>", " ").replaceAll("<br/>", " ").replace(/[*`_]/g, "").trim();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The entries of `text` and the structure findings around them.
 *
 * Reads the file line by line rather than with one regex, because an entry is defined by its
 * neighbours: a line is a term only because the next line is a definition, and an entry belongs to
 * the run of entries around it.
 */
function parse(text: string): { rows: Row[]; findings: Finding[] } {
  const lines = splitLines(text);
  const rows: Row[] = [];
  const findings: Finding[] = [];
  let fence: string | null = null;
  let run = 0;
  let index = 0;

  /** A bare line whose successor is a definition — that is what makes a term. */
  const isTerm = (pos: number) =>
    pos + 1 < lines.length &&
    !!lines[pos].trim() &&
    !NOT_A_TERM_RE.test(lines[pos]) &&
    !DEFINITION_RE.test(lines[pos]) &&
    DEFINITION_RE.test(lines[pos + 1].trimEnd());

  /** An unindented block sitting between one entry and the next. */
  const detachedBlock = (pos: number) => {
    let start = pos;
    while (start < lines.length && !lines[start].trim()) start++;
    if (start === pos || start >= lines.length || !DETACHABLE_RE.test(lines[start])) return false;
    let end = start;
    while (end < lines.length && lines[end].trim()) end++;
    while (end < lines.length && !lines[end].trim()) end++;
    return isTerm(end);
  };

  while (index < lines.length) {
    const line = lines[index].trimEnd();

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      fence = fence === marker ? null : (fence ?? marker);
      index++;
      continue;
    }
    if (fence) {
      index++;
      continue;
    }

    if (HEADING_RE.test(line)) {
      run = 0;
      index++;
      continue;
    }

    if (DEFINITION_RE.test(line)) {
      findings.push({ line: index + 1, message: "definition has no term above it" });
      index++;
      continue;
    }

    if (!isTerm(index)) {
      if (line.trim()) run = 0;
      index++;
      continue;
    }

    const term = line.trim();
    index++;
    let match: RegExpExecArray | null;
    while (index < lines.length && (match = DEFINITION_RE.exec(lines[index].trimEnd()))) {
      let definition = match.groups?.definition as string;
      const start = index;
      index++;
      // A line the author broke on purpose, with a trailing backslash, carries on the same
      // definition. Collect it, so a term named after the break still counts as a reference.
      while (index < lines.length && definition.endsWith("\\") && lines[index].trim()) {
        definition = `${definition.slice(0, -1)} ${lines[index].trim()}`;
        index++;
      }
      rows.push({ term, definition, line: start + 1 });
      // Two ways a definition loses content silently, both of which render without an error and
      // so cannot be caught by reading the output.
      //
      // A non-blank line here is folded into the definition above it, so the break the author
      // wrote disappears — and if that line was the next term, the whole entry disappears with
      // it. This is the definition-list version of a raw newline breaking a table row.
      while (index < lines.length && lines[index].trim() && !DEFINITION_RE.test(lines[index].trimEnd())) {
        findings.push({
          line: index + 1,
          message: `line after the definition of '${term}' is folded into it, losing the break; end the line above with a backslash, or indent this line by four spaces to make it a block of the definition`,
        });
        index++;
      }
      // An unindented block between two entries detaches from the definition above it: the
      // renderer closes the list, emits the block on its own, and opens a second list. Only
      // flagged between entries, where it cannot be the prose that follows the glossary.
      if (detachedBlock(index)) {
        findings.push({
          line: index + 2,
          message: `block after the definition of '${term}' is not indented, so it detaches from the definition and splits the list in two; indent it by four spaces`,
        });
      }
    }

    run++;
    if (run === MAX_TERMS_PER_LIST + 1) {
      // once per run, not once per term past the line
      findings.push({
        line: index,
        message: `more than ${MAX_TERMS_PER_LIST} terms run together here; consider splitting them under a new heading`,
        note: true,
      });
    }
  }

  return { rows, findings };
}

/** Each distinct reference cycle as a list of terms, its first term repeated at the end. */
function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];

  const visit = (node: string) => {
    state.set(node, "open");
    stack.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (state.get(next) === "open") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, "done");
  };

  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) visit(node);
  }

  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = [...new Set(cycle)].sort().join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkFile(path: string): { errors: string[]; notes: string[] } {
  const { rows, findings } = parse(readFileSync(path, "utf8"));
  if (!rows.length) return { errors: [], notes: [] };

  const errors = findings.filter((f) => !f.note).map((f) => `${path}:${f.line}: ${f.message}`);
  const notes = findings.filter((f) => f.note).map((f) => `${path}:${f.line}: ${f.message}`);

  const seen = new Map<string, number>();
  for (const { term, line } of rows) {
    const first = seen.get(term);
    if (first !== undefined) errors.push(`${path}:${line}: '${term}' is already defined on line ${first}`);
    else seen.set(term, line);
  }

  // Map every spelling of every defined term back to its canonical term.
  const lookup = new Map<string, string>();
  for (const term of seen.keys()) {
    for (const form of aliases(term)) {
      if (!lookup.has(form)) lookup.set(form, term);
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const { term, definition, line } of rows) {
    const prose = stripMarkup(definition);
    if (prose.endsWith(".")) errors.push(`${path}:${line}: definition of '${term}' ends with a period`);

    const targets = new Set<string>();
    for (const [form, canonical] of lookup) {
      if (!new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(form)}(?![\\p{L}\\p{N}_-])`, "u").test(prose)) continue;
      if (canonical === term) errors.push(`${path}:${line}: definition of '${term}' restates the term`);
      else targets.add(canonical);
    }
    graph.set(term, targets);
  }

  for (const cycle of findCycles(graph)) {
    const trail = cycle.join(" -> ");
    if (cycle.length === 3) {
      // A -> B -> A: the two terms define each other
      errors.push(
        `${path}:${seen.get(cycle[0])}: '${cycle[0]}' and '${cycle[1]}' define each other (${trail}); state the relationship once, in one direction`,
      );
    } else {
      notes.push(`${path}:${seen.get(cycle[0])}: indirect reference loop ${trail}`);
    }
  }

  return { errors, notes };
}

function main(paths: string[]): number {
  const results = paths.map(checkFile);
  const errors = results.flatMap((result) => result.errors);
  const notes = results.flatMap((result) => result.notes);

  if (notes.length) {
    console.log("Glossary notes (not failures):\n");
    for (const note of notes) console.log(`  - ${note}`);
    console.log();
  }

  if (!errors.length) return 0;

  console.log("Glossary check failed:\n");
  for (const error of errors) console.log(`  - ${error}`);
  console.log(`\n${errors.length} issue(s) in ${paths.length} file(s). See CLAUDE.md ('Glossary conventions').`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
