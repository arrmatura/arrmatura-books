# Book sites

The tooling that turns a **content repo**, a public GitHub repo of markdown, into a book
site on Firebase Hosting and a book in EPUB and PDF. Each content repo hosts its own site
and calls this tooling from the sibling checkout `../arrmatura-books`. Users today:
[engx](https://github.com/arrmagazin/engx) and [almaat](https://github.com/arrmagazin/almaat).

| Path | What it is |
| --- | --- |
| `site/gen.ts` | Writes the content repo's `www/`: `index.html` and the files of `site/www/` |
| `site/cml/` | The page-shell templates `gen.ts` renders `index.html` from |
| `site/www/` | Files every site serves unchanged: `service-worker.js`, `onload.js` |
| `site/serve.ts` | Serves the content repo's `www/` and rebuilds its UI bundle on change |
| `site/release.sh` | Releases the content repo and deploys its site |
| `book/` | The book builder. See [book/README.md](../book/README.md) |

## A content repo

| Path | Served | Purpose |
| --- | --- | --- |
| `docs/` | via jsDelivr | The markdown. The site and the book read it |
| `package.json` | no | The one config surface: app metadata, theme, store link, book metadata (`book`), `esbuild`, scripts |
| `index.ts` | no | The UI entry: imports `launchBook` from `../arrmatura-books` and calls it |
| `www/` | yes | Firebase public root |
| `www/index.html`, `service-worker.js`, `onload.js` | yes | Written by `npm run gen`; never edit by hand. Committed |
| `www/favicon.svg`, `site.webmanifest`, `robots.txt` | yes | The site's own, by hand |
| `www/dist/` | yes | Gitignored: `index.js` and `index.css`, built by `npm run build` |
| `book/cover.png` | no | The book cover's photograph. Optional |
| `firebase.json`, `.firebaserc` | no | `hosting.site` is the Firebase site id, `public: "www"`, `** -> /index.html` |
| `build/` | no | Gitignored: the book's outputs and caches |

Its `package.json` scripts:

```json
"gen": "bun ../arrmatura-books/site/gen.ts",
"build": "npx --yes npm-run-all --parallel build:*",
"build:ts": "bun ../arrmatura-books/scripts/build.ts",
"build:css": "npx --yes @tailwindcss/cli --cwd ../arrmatura-books -i index.css -o \"$PWD/www/dist/index.css\"",
"start": "export PORT=${PORT:-8092} && npm run stop && npx --yes npm-run-all --parallel start:*",
"start:serve": "bun ../arrmatura-books/site/serve.ts",
"start:css": "npm run build:css -- --watch",
"start:open": "npx --yes wait-on http://localhost:${PORT:-8092} && open http://localhost:${PORT:-8092}/",
"stop": "lsof -t -sTCP:LISTEN -i tcp:${PORT:-8092} | xargs -r kill -9",
"book": "bun ../arrmatura-books/book/build.ts",
"predeploy": "npm run build",
"deploy": "firebase deploy --only hosting",
"release": "../arrmatura-books/site/release.sh"
```

and `"esbuild": { "entryPoints": ["index.ts"] }`. `build:css` runs Tailwind from this checkout,
so it scans the same sources as this repo's own `dist/index.css`.

Needs [bun](https://bun.sh), the firebase CLI (logged in), and this repo checked out beside it
with `npm install` run, so `arrmatura`, `ultimus`, `esbuild` and `arrmatura-web` resolve for
`gen.ts`, `serve.ts` and the bundle. The book needs more;
see [book/README.md](../book/README.md).

## The page

`www/index.html` holds `window.R`, the `<script id="R" type="application/json">`, the app's
only config. `gen.ts` fills it from the content repo:

| `window.R` | From |
| --- | --- |
| `app` | `package.json`: `name` → `id`, `displayName` → `name`, and `version`, `description`, `author`, `keywords`, `email`, `copyright` as they are |
| `book.indexUrl`, `book.docUrl` | jsDelivr, at `<owner>/<repo>@<version>`: owner and repo from git remote `origin`, version from `package.json` |
| `book.scope` | Always `docs` |
| `book.store` | `package.json` `store`, when set. The sidebar links to it |

The `<meta>` tags read the same values. The look comes from the same file and stays out of
`window.R`: `theme` → `data-theme` (DaisyUI, default `corporate`) and `themeColor` → the
`theme-color` meta (default `#1060c8`).

- **Docs at a tag.** The page reads the docs from jsDelivr at the version tag, not the working
  tree, so a doc change shows only after a release. jsDelivr resolves `1.2.3` to a tag
  `v1.2.3` as well.
- **UI from the content repo.** The page loads `/dist/index.js` and `/dist/index.css`, which the
  content repo builds from this checkout's working tree, not from a tag.
- **Templates.** `cml/html.xml` is the document (`Html`, `Index`); `cml/head.xml` is `Head`;
  `cml/seo.xml` the meta tags. Inline JS in a template is CML text: a bare `{ }` is read as an
  expression and silently dropped, so scripts there have no blocks or object literals, and
  `&&` is written `&amp;&amp;`. `window.R` comes in as data through the `json` pipe.
- **Dark mode.** `theme` is the light theme. The sidebar's sun/moon button (`ThemeService`)
  sets `data-theme="dark"` on `<body>` and keeps the choice in localStorage `theme`; with
  none stored, the OS colour scheme decides. The one-line script at the top of `<body>` in
  `cml/html.xml` repeats that read before first paint, so there is no light flash.
- **Service worker.** `onload.js` registers it off localhost. It keeps one cache, `cache`,
  and caches only CDN files (fonts, icons, jsDelivr), forever. Site files are never cached,
  so a deploy needs no cache bump. On activate it deletes the `cache-v<N>` caches of an
  older per-deploy worker.

## Release and deploy

`npm run release` in a content repo (`site/release.sh`):

1. Checks the repo is a clean `main`, not behind origin.
2. Runs `gen`. HEAD already tagged with its version and `www/` unchanged → nothing to release.
   Otherwise, if that version is tagged, bumps patch and runs `gen` again; a version still
   untagged is released as is.
3. Commits `<version>`, pushes, tags, pushes the tag. The tag keeps the repo's style, `1.2.3`
   or `v1.2.3`, taken from its nearest tag.
4. Runs `deploy`.

So a doc change goes live with one command. A change here goes live with the next `deploy`
of each content repo, which builds the UI from this checkout first (`predeploy`).

`npm run deploy` alone builds `www/dist/` and pushes `www/`. `npm start` serves it locally,
rebuilds on change and opens the browser; `npm run stop` frees the port.

## Add a content repo

1. Copy `www/`, `book/`, `index.ts`, `firebase.json`, `.firebaserc`, the scripts and `esbuild` above
   from engx.
   Set `hosting.site` to a new Firebase site id and create it once:
   `firebase hosting:sites:create <id>`.
2. Set `displayName`, `description`, `author`, `keywords` (and `theme`, `themeColor`,
   `store` if wanted) and `book` in `package.json`. Replace `favicon.svg`, `site.webmanifest`,
   `robots.txt` and `book/cover.png`.
3. Gitignore `build/`, `.firebase/`, `firebase-debug*.log`, `www/dist/`.
4. `npm run release`.
