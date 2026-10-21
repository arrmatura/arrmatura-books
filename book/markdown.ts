/**
 * Line-level markdown transforms, each aware of fenced code blocks.
 *
 * None of these knows about files or sites: they take text and return text, which is
 * what lets assemble.ts apply them one document at a time.
 */

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})(\s+\S.*)$/;
const VOID_TAG_RE = /<(br|hr|wbr|img)((?:\s[^>]*?)?)\s*\/?>/gi;
const UNSLUGGABLE_RE = /[^\p{L}\p{N}_\- ]/gu;
const THEMATIC_BREAK_RE = /^ {0,3}-{3,}[ \t]*$/;
const EXPLICIT_ID_RE = /\{#([^}\s]+)[^}]*\}\s*$/;
// A raw block rather than a bare \clearpage line: the explicit syntax needs no
// markdown extension to be read as LaTeX, and every other writer drops it.
const PAGE_BREAK = "```{=latex}\n\\clearpage\n```";
const DOCUMENT_HEADING_RE = /^(#{1,6} .*\{#[^}\s]+)\}/;
const FOOTNOTE_RE = /\[\^([^\]\s^[]+)\]/g;
const INLINE_CODE_RE = /(`+[^`]*`+)/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
// Lines that open some other block (heading, quote, table, HTML, list) and so cannot be
// the text of a setext heading.
const NOT_HEADING_TEXT_RE = /^(\s{4,}|\s*$|\s*[#>|<]|\s*[-*+]\s|\s*\d+[.)]\s|\s*[-*_=](\s*[-*_=]){2,}\s*$)/;

type Fence = string | null;

/** Walk the fence state one line forward. Returns whether the line was a fence. */
function fenceStep(fence: Fence, bare: string): [boolean, Fence] {
  const match = FENCE_RE.exec(bare);
  if (!match) return [false, fence];
  const marker = match[1][0];
  return [true, fence === null ? marker : fence === marker ? null : fence];
}

/** The anchor a renderer generates for a heading. Mirrors check_links.slugify. */
export function slugify(title: string): string {
  const text = title.replaceAll("*", "").replaceAll("`", "").trim().toLowerCase();
  return text.replace(UNSLUGGABLE_RE, "").replaceAll(" ", "-");
}

/** Demote every ATX heading by `by` levels, ignoring fenced code blocks. */
export function shiftHeadings(text: string, by = 1): string {
  let fence: Fence = null;
  return text
    .split("\n")
    .map((bare) => {
      let isFence: boolean;
      [isFence, fence] = fenceStep(fence, bare);
      if (isFence) return bare;
      const heading = fence === null ? HEADING_RE.exec(bare) : null;
      if (!heading) return bare;
      const level = heading[1].length + by;
      if (level > 6) throw new Error(`heading would exceed level 6: ${JSON.stringify(bare)}`);
      return "#".repeat(level) + heading[2];
    })
    .join("\n");
}

/**
 * Rewrite setext headings (`Title` over `=====` or `-----`) as ATX (`# Title`).
 *
 * Every other transform here reads ATX headings only, and normalizeThematicBreaks
 * would turn a `-----` underline into `***`, leaving the heading as a paragraph over a
 * rule. GitHub READMEs often use setext, so they are converted first. Matches pandoc's
 * reading: one line of text, a blank line (or the start) before it, outside fences.
 */
export function setextToAtx(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: Fence = null;
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i];
    let isFence: boolean;
    [isFence, fence] = fenceStep(fence, bare);
    const underline = SETEXT_UNDERLINE_RE.exec(lines[i + 1] ?? "");
    const blankBefore = i === 0 || lines[i - 1].trim() === "";
    if (!isFence && fence === null && underline && blankBefore && !NOT_HEADING_TEXT_RE.test(bare)) {
      out.push(`${underline[1][0] === "=" ? "#" : "##"} ${bare.trim()}`);
      i++;
      continue;
    }
    out.push(bare);
  }
  return out.join("\n");
}

/** The text of the first level-1 heading outside fenced code, or null if there is none. */
export function topHeading(body: string): string | null {
  let fence: Fence = null;
  for (const bare of body.split("\n")) {
    let isFence: boolean;
    [isFence, fence] = fenceStep(fence, bare);
    if (isFence || fence !== null) continue;
    const heading = HEADING_RE.exec(bare);
    if (heading && heading[1].length === 1) return heading[2].replace(/\s+#+\s*$/, "").trim();
  }
  return null;
}

/**
 * Close void HTML elements, so `<br>` becomes `<br/>`, outside fenced blocks.
 *
 * EPUB3 is XHTML, and pandoc passes raw inline HTML through verbatim rather than
 * parsing it. A bare `<br>` in a table cell therefore reaches the EPUB as a
 * mismatched tag, and a conforming reader abandons the rest of that page. The
 * glossary convention asks authors for `<br>` in a multi-line cell, so the builder is
 * the right place to make it well-formed. Fences are skipped: mermaid uses `<br/>` in
 * labels, and a fence is not HTML.
 */
export function closeVoidTags(text: string): string {
  let fence: Fence = null;
  return text
    .split("\n")
    .map((bare) => {
      let isFence: boolean;
      [isFence, fence] = fenceStep(fence, bare);
      if (isFence || fence !== null) return bare;
      // trimEnd: the attribute group absorbs the space in `<br />`, which would
      // otherwise come back out as `<br />` rather than a uniform `<br/>`.
      return bare.replace(VOID_TAG_RE, (_, tag: string, attributes: string) => `<${tag}${attributes.trimEnd()}/>`);
    })
    .join("\n");
}

/**
 * Prefix every footnote label with `prefix`, so `[^1]` becomes `[^prefix--1]`,
 * outside fenced blocks and inline code.
 *
 * Each document numbers its own notes from 1. Assembled into one, the labels collide
 * and pandoc gives every `[^1]` the first `[^1]:` it met: the wrong citation, with
 * only a warning. Code is skipped: `[^a-z]` there is a regex, not a note.
 */
export function scopeFootnotes(text: string, prefix: string): string {
  let fence: Fence = null;
  return text
    .split("\n")
    .map((bare) => {
      let isFence: boolean;
      [isFence, fence] = fenceStep(fence, bare);
      if (isFence || fence !== null) return bare;
      return bare
        .split(INLINE_CODE_RE)
        .map((part, i) => (i % 2 ? part : part.replace(FOOTNOTE_RE, `[^${prefix}--$1]`)))
        .join("");
    })
    .join("\n");
}

/**
 * Rewrite '---' rules as '***'.
 *
 * A bare dashed line is ambiguous in pandoc's markdown: a YAML metadata block, a
 * setext heading underline, or a multiline-table delimiter. Read as the last of
 * those it swallows every following heading into table cells, silently and with a
 * zero exit code. '***' is only ever a horizontal rule.
 */
export function normalizeThematicBreaks(text: string): string {
  let fence: Fence = null;
  return text
    .split("\n")
    .map((bare) => {
      let isFence: boolean;
      [isFence, fence] = fenceStep(fence, bare);
      if (isFence) return bare;
      return fence === null && THEMATIC_BREAK_RE.test(bare) ? "***" : bare;
    })
    .join("\n");
}

/**
 * Give every heading an explicit, globally unique id.
 *
 * A level-1 heading is the document itself, so it takes the document's anchor.
 * Everything below is namespaced under it, because section names like 'Best
 * Practices' repeat across chapters and a renderer would silently renumber them.
 */
export function addHeadingIds(text: string, documentAnchor: string): string {
  let fence: Fence = null;
  const seen = new Map<string, number>();
  return text
    .split("\n")
    .map((bare) => {
      let isFence: boolean;
      [isFence, fence] = fenceStep(fence, bare);
      if (isFence) return bare;
      const heading = fence === null ? HEADING_RE.exec(bare) : null;
      if (!heading) return bare;
      const [, hashes, textPart] = heading;
      let anchor = hashes.length === 1 ? documentAnchor : `${documentAnchor}--${slugify(textPart)}`;
      const repeats = seen.get(anchor) ?? 0;
      seen.set(anchor, repeats + 1);
      if (repeats) anchor = `${anchor}-${repeats}`;
      return `${hashes}${textPart.trimEnd()} {#${anchor}}`;
    })
    .join("\n");
}

/**
 * Open a document on a fresh page, in both formats.
 *
 * A folder's index.md is a \chapter and already breaks; its siblings are \section,
 * which does not, so the PDF needs an explicit \clearpage. The EPUB has no pages of
 * its own, but a paginated reader honours a CSS break, and pandoc puts a heading's
 * classes on the <section> it wraps — so the opening heading is marked `.document`
 * and book/epub.css hangs the break on that.
 */
export function startOnANewPage(body: string): string {
  const marked = body.replace(DOCUMENT_HEADING_RE, "$1 .document}");
  return `${PAGE_BREAK}\n\n${marked}`;
}

/** Heading slugs that occur more than once, which a renderer will rename. */
export function duplicateAnchors(markdown: string): string[] {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  let fence: Fence = null;
  for (const line of markdown.split("\n")) {
    let isFence: boolean;
    [isFence, fence] = fenceStep(fence, line);
    if (isFence) continue;
    const heading = fence === null ? HEADING_RE.exec(line) : null;
    if (!heading) continue;
    const explicit = EXPLICIT_ID_RE.exec(heading[2]);
    const slug = explicit ? explicit[1] : slugify(heading[2]);
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);
    if (count === 2) duplicates.push(slug);
  }
  return duplicates;
}
