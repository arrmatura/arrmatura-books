# The book builder

`book/build.ts` turns a content repo's markdown into a single document and renders it as
an EPUB and a PDF. It runs on bun with Node built-ins only. pandoc does the rendering, and
xelatex does the PDF. It has no tests at present.

It runs in the content repo, the sibling checkout beside this one, as that repo's
`npm run book` (`bun ../arrmatura-books/book/build.ts`). The working directory is the repo
root, `ROOT`, and the book is built from its working tree, not from a tag.

```sh
npm run book                    # both formats
npm run book -- --pdf           # one format (or --epub)
npm run book -- --markdown      # assemble and verify only, render nothing
```

## Inputs and outputs

All paths are relative to the content repo root.

| What | Where |
| --- | --- |
| The markdown | `docs/` |
| Book name | `package.json` `name`; it names the outputs |
| Title, author, rights | `package.json` `book`: pandoc metadata (`title`, `subtitle`, `language`, `subject`, `identifier`…) over the top-level `author`, `copyright` (as `rights`) and `description`. Written to `build/metadata.json` for `--metadata-file`. No `book.title` → the build fails |
| Cover photograph | `package.json` `book.coverPhoto`, default `book/cover.png`, PNG only. Missing → no cover, the build continues |
| Cover palette | `package.json` `book.coverColors`: any of `paper`, `ink`, `muted`, `accent` over the kit's |
| Content model | `book/content.ts`, optional: see [Content model](#content-model) |
| Outputs | `build/<name>.md`, `.epub`, `.pdf` |
| Caches | `build/metadata.json`, `build/cover/`, `build/epub-default.css`, `build/diagrams/` (content-addressed) |

## Modules

| File | Concern |
| --- | --- |
| `build.ts` | CLI, flags, the `ContentModel` hook, building the book |
| `context.ts` | `ROOT`, `BUILD`, `DIAGRAMS`, the `Site` interface, `resolveSite()`, shared helpers |
| `assemble.ts` | frontmatter, titles, link rewriting, document anchors, reading order |
| `markdown.ts` | line transforms that skip fenced code: setext to ATX, heading ids and levels, breaks, void tags |
| `diagrams.ts` | mermaid extraction and the `mermaid-cli` run |
| `raster.ts` | headless Chrome rasterizer |
| `cover.ts` | the cover SVG and its cache |
| `render.ts` | the PDF preamble, `verifyAnchors`, the pandoc calls |
| `table-widths.lua`, `table-rules.lua`, `code-breaks.lua`, `epub.css` | pandoc filters and the EPUB stylesheet |

`resolveSite()` checks the inputs and returns a `Site` object that carries `name`, `src`
(the repo root), `docs`, `build` and `coverPhoto`, all absolute, and the pandoc `metadata`
object, to whatever needs them.

## Content model

The defaults read a plain docs tree. A repo whose pages need more (app links, app tokens, a part per scope) writes `book/content.ts`, and the builder imports it. Each export it names replaces the kit's; the rest stay the kit's.

| Export | Replaces |
| --- | --- |
| `collectDocuments(site)` | reading `docs/` into documents in reading order |
| `assemble(documents, site)` | turning them into one markdown document |
| `pandocArgs(target)` | nothing: extra arguments after the kit's for `"epub"` or `"pdf"`. A repeated flag (`--toc-depth`, `--split-level`) wins; a `-V header-includes=` adds to the kit's preamble, so a `\definecolor` there overrides the kit's colour |

The module imports the kit's helpers (`markdown.ts`, `context.ts`) by relative path, `../../arrmatura-books/book/…`, so it shares their module instances. taalmoed's is the worked example.

## What it does that pandoc cannot

- **Titles.** A document's title is its frontmatter `title`, else its first level-1
  heading, else its file name: the number prefix dropped, kebab-case turned to words, the
  first letter capital. An `index.md` takes its folder's name. A body with no level-1
  heading is opened with `# <title>` before reading order, ids or links see it.
  Frontmatter is optional; frontmatter with no closing `---` fails. A leading byte-order
  mark and CRLF line endings are normalized first, so they cannot hide the frontmatter.
- **Setext headings.** `Title` over `=====` (or `-----`) is rewritten as `# Title` (or
  `## Title`) before anything else reads the body, since every later step reads ATX
  headings only, and `---` normalizing would turn a `-----` underline into a rule. As in
  pandoc, the text is one line with a blank line before it, outside fenced code.
- **Reading order.** The root `index.md` first, then folders in name order, each led by
  its `index.md`, which keeps its heading level and so reads as the chapter opener. Its
  siblings are demoted one level beneath it. Any other root file closes the book as a
  chapter of its own. A root `CLAUDE.md` or `INDEX.md` is about the repo, not in the book:
  it is left out, and a link to it keeps its words and loses the link. Only `index.md`
  opens a chapter; a `README.md` sorts as an ordinary page.
- **One document, one page.** Every file opens at the top of a page. An `index.md` is a
  `\chapter` and breaks on its own. Its siblings are `\section`, which does not, so the
  assembler puts a raw `\clearpage` block before each. Raw, so every writer but LaTeX drops
  it. The same siblings' opening headings are marked `.document`, which pandoc carries onto
  the `<section>` it wraps, and `epub.css` hangs a `page-break-before` on that for readers
  that paginate. A heading's id is read as far as the first space, because an attribute
  block can hold a class as well as an id.
- **Unique heading ids.** Every heading gets an explicit `{#doc-anchor--section}` id.
  Section names like "Best Practices" repeat across chapters, and a renderer would
  otherwise renumber them silently and send links to the wrong chapter.
- **Link rewriting.** Cross-document links become intra-document anchors. A link with no
  anchor points at the target document's title. A link to any other file in the content
  repo, such as an image, becomes a path relative to the repo root (`src`).
- **Normalizing `---`.** A bare dashed line is ambiguous in pandoc's markdown: YAML
  metadata, a setext underline (already rewritten, see above), or a multiline-table
  delimiter. Read as the last of those, it swallows every following heading into table
  cells, with a zero exit code. The builder emits `***` instead. Then `verifyAnchors` re-renders the assembled file and fails the
  build if any declared heading id or link target did not survive.
- **Mermaid diagrams.** Neither format renders a mermaid fence; pandoc prints it as code.
  So diagrams are rasterized first, by `mermaid-cli` under `npx` at a pinned version. Each
  PNG is named for a digest of its own source and cached in `build/diagrams/`, so an
  unchanged diagram is never re-rendered. All pending
  diagrams go through one `mermaid-cli` run, because it numbers its output by each block's
  *position in the input*, not by the order renders finish. That is what makes the rename
  to `<hash>.png` safe. If `npx` is missing or a diagram will not parse, that block stays a
  code block with a warning and the build continues.
- **The cover.** Generated, not drawn: an SVG built from the title, subtitle and author in
  `package.json` `book`, over the cover photograph, which sits flush with the bottom edge at its own aspect
  ratio and fades into the dark page across the top 45% of itself. Headless Chrome
  rasterizes it, cached in `build/cover/` by a digest of the SVG. The SVG carries
  the photograph inline as a data URI, so a replaced photograph re-renders the cover. The
  EPUB takes it as `--epub-cover-image`. The PDF opens on it full-bleed, from
  `\AtBeginDocument`, because pandoc's template puts `\maketitle` ahead of any
  `--include-before-body`. The same preamble empties `\maketitle`, since the cover
  already carries all three lines. Generated so the cover cannot drift from the metadata
  inside the book. No photograph or no Chrome means no cover, and the build continues.
  Chrome is looked for at the macOS path `/Applications/Google Chrome.app`.
- **Closing void tags.** `<br>` becomes `<br/>` outside fenced blocks. EPUB3 is XHTML and
  pandoc passes raw inline HTML through verbatim, so a bare `<br>` reaches the EPUB as a
  mismatched tag, and a conforming reader abandons the rest of that page.

## Paths at render time

Every pandoc call runs with cwd `ROOT`, the content repo, and `--resource-path <ROOT>`.
The assembled markdown names two kinds of image, both relative to `ROOT`: the content
repo's own, and the generated diagrams in `build/diagrams/`. LaTeX's `\includegraphics` of the cover is not
resolved through the resource path. xelatex runs in pandoc's working directory, which is
why the cover path is relative to `ROOT`.

## Image formats in the PDF

Diagrams are PNG at scale 3; the cover is JPEG at scale 2. A diagram is flat line art,
where lossless costs almost nothing. The cover is mostly photograph and barely
compresses, so PNG would multiply its size for no visible gain. xelatex embeds JPEG
without re-encoding it. Chrome picks the format from the extension and accepts `.jpg` but
not `.jpeg`. Both scales are folded into the cache key, so retuning one re-renders rather
than serving images made at the old setting.

**No SVG in the content.** xelatex cannot embed SVG, so an SVG figure in a content repo is
dropped from the PDF. The only SVG in the build is the cover, which the builder generates.
Content should use a mermaid diagram or a PNG.

## Table column widths

Once a pipe-table line runs past 72 characters, pandoc takes the column widths from the
dashes in the `| --- |` separator, so a prose column can come out a tenth of the page wide.
A shorter table gets no widths and is set narrow and centred. `table-widths.lua` sets
every table to the full measure and sizes each column by the text it holds, header
included, never below its longest word. It runs for both formats, before
`table-rules.lua`, which turns each table into raw LaTeX.

## Separated table rows

pandoc leaves nothing between body rows in either format, and rows of wrapped prose run
together. Both formats get modest cell padding and a hairline above each row (a quarter
black in the PDF, `#ccc` in the EPUB), with a darker rule under the header. The padding is
modest because every point of it adds pages to a table-heavy book.

- **PDF.** The rules cannot come from the preamble. Inside a `longtable` the row
  terminator is longtable's own `\LT@tabularcr`, so patching `\\` does nothing and
  patching `\LT@tabularcr` breaks the header row. `table-rules.lua` re-renders each table
  through pandoc's own LaTeX writer and inserts the rules into the result. The table then
  comes back as a raw block, so pandoc no longer sees a table, and the build passes
  `-V tables=true` to keep `longtable` and `booktabs` loaded.
- **EPUB.** `--css` **replaces** pandoc's default stylesheet rather than adding to it,
  which drops the whole baseline typography. So the build writes pandoc's own default out
  with `--print-default-data-file epub.css` and layers `epub.css` on top. That also keeps
  the default in step with the installed pandoc.

## Blockquotes as callouts

A blockquote is drawn as a callout, the same in both formats: warm paper (`#FAF4E8`) with
a 3pt amber bar (`#EFAE16`) down the left edge and the indent dropped. The PDF gets it from
`mdframed`, redefining the `quote` environment. Not the `framed` package's `snugshade`: it
draws no rule and takes its colour from `shadecolor`, which pandoc's code highlighting
already uses. The EPUB gets the same from `epub.css`.

## The PDF layout

A reading book rather than a paper: the `book` class one-sided on A4, 11pt on 1.15
leading, 2.5cm/2.8cm margins, `--top-level-division=chapter` so a folder opens a chapter
on a fresh page, and running heads carrying the chapter title.

Long inline code gets breakpoints from `code-breaks.lua`, because identifiers like
`iam.disableServiceAccountKeyCreation` are otherwise unbreakable and run into the margin.
It allows a break only after a space, dot, slash, colon, hyphen or underscore, or between
a lower- and an upper-case letter, and leaves code under 12 characters alone. `seqsplit`,
which breaks between any two characters, cannot be used: it fails on the `\^{}` pandoc
writes for a caret.

The PDF sets `Times New Roman` with `Menlo` for code, the fonts verified to cover the
box-drawing characters diagrams use. If either is missing, the PDF still builds, with
those glyphs dropped and a warning.
