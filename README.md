# Arrmatura Books

The docs-site kit: everything needed to turn a folder of markdown into a browsable
site.

## Install

```bash
npm install arrmatura-books 
```

## Usage

```ts
import { launchBook } from "arrmatura-books";
launchBook();
```

```css
@source "arrmatura/arrmatura-books/dist/index.css";
```

## Configuration

`App` takes `R.app` (`name`, `logo`) for the header — supplied by the page as
`window.R` — and serves:

| What | Where |
| --- | --- |
| Site-tree index | `/index.json` — `{ tree: [{ path, type: "dir" \| "file" }] }`; GitHub's `tree` / `blob` also accepted |
| One document | `/docs/*`, `*` substituted with the id |
| Default document | `index.md`, when the `doc` nav param is unset |

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
npm run codegen    # registry.ts + catalog.json — both generated, never hand-edited
npm run build      # dist/index.cjs, the `require` condition
npm run gates      # typecheck + lint
```
