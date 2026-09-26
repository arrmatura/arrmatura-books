# Arrmatura Books

The docs-site kit for Arrmatura: everything needed to turn a folder of markdown into a browsable
site — a root `App` shell, a collapsible file tree, a self-check quiz, and docs-flavoured
overrides of the `MD*` components from `arrmatura-markdown`, which it re-exports.

It is one flat kit over `arrmatura-web`, in the same shape as that package's own modules: `cml/`
and `src/` beside a generated `registry.ts`, registered as `Object.values(books)`.

## Install

```bash
npm install arrmatura-books arrmatura-web
```

`arrmatura-web`, `arrmatura` and `ultimus` are peer dependencies. `arrmatura-markdown` comes as a
dependency and is re-exported, so registering this kit registers the markdown one too.

## Usage

A site is a thin shell with no `cml/` tree of its own:

```ts
import { components } from "arrmatura-books";
import { launchPlatformApp } from "arrmatura-web";

launchPlatformApp({ components });
```

`components` carries the markdown kit first, then this kit's own. Pass that array, not the
module namespace: the registry reads a plain object as `{ tag: template }`, which would register
each file's whole source under its export name.

Tailwind must see this kit's markup too, or its classes are purged:

```css
@source "./node_modules/arrmatura-web/**/*.xml";
@source "./node_modules/arrmatura-markdown/**/*.xml";
@source "./node_modules/arrmatura-books/**/*.xml";
```

## What it registers

| Component | Role |
| --- | --- |
| `App` | Root shell — mounts storage, navigation and `DocsService`, then lays the tree beside the rendered document |
| `DocsTree`, `.Dir`, `.File` | File-tree navigator over `@bookIndex`; mounts `BookIndexTreeService`; selecting a file sets the `doc` nav param |
| `DocsSidebar` | Declared, not implemented — `App` lays out the sidebar itself |
| `Quiz` | Graded drill over a question set, filterable by topic and tag |
| `MDDocument.Book`, `MDLink.Book`, `MDSection.Book`, `MDCheckbox.Book` | Prefix-scoped overrides of the `arrmatura-markdown` defaults — see below |
| `BookIndexTreeService` | Loads the site-tree index; open path, node lookup and in-document link following (`gotoLocalLink`) |
| `DocsService` | Loads the selected document through `resolveUrlPattern` |
| `QuizService` | Quiz state: spaced repetition, progress, score |

## Configuration

`App` takes no props. It reads `R.app` (`name`, `logo`) for the header — supplied by the page as
`window.R` — and serves:

| What | Where |
| --- | --- |
| Site-tree index | `/index.json` — `{ tree: [{ path, type: "dir" \| "file" }] }`; GitHub's `tree` / `blob` also accepted |
| One document | `/docs/*`, `*` substituted with the id |
| Default document | `index.md`, when the `doc` nav param is unset |

## Markdown overrides

`App` renders the document with `<MarkdownView prefix="Book">`, so the renderer emits `MD*.Book`
tags. The Arrmatura registry falls back through dotted prefixes (`MDCode.Book` → `MDCode`), so
only the components this kit declares change:

Every `MD*` component comes from `arrmatura-markdown`; this kit changes four of them.

| Override | Effect |
| --- | --- |
| `MDDocument.Book` | Document header with expand-all / collapse-all, portalled into `#docHeader` |
| `MDLink.Book` | An in-repo link resolves through `BookIndexTreeService`; a link with a host opens a new tab |
| `MDSection.Book` | Sections open, close and record read progress in the view service |
| `MDCheckbox.Book` | Task boxes toggle read progress |

Every override is scoped to the `Book` prefix, so a `MarkdownView` without it — the quiz's
question text, for one — keeps the plain `arrmatura-markdown` rendering, and registration order
plays no part.

## Two things that are easy to get wrong

**`BookIndexTreeService` must be mounted as `Ref="bookIndex"`.** `DocsTree` and `MDLink.Book` bind
`@bookIndex.*` by that literal name, and it must sit above both — any other Ref leaves the tree
empty and floods the console with `No such ref: bookIndex`.

**Cross-document links resolve by literal path.** A `.md` link is resolved against the open
document and matched against the site tree — exact id first, then file name. One that matches
nothing logs `No such document` and goes nowhere; a target with a host, or without an `.md`
extension, opens in a new tab.

## Development

```bash
npm install        # also links ../arrmatura, ../arrmatura-web, ../arrmatura-markdown and ../ultimus
npm run codegen    # registry.ts + catalog.json — both generated, never hand-edited
npm run build      # dist/index.cjs, the `require` condition
npm run gates      # typecheck + lint
```
