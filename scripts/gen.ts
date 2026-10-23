/// <reference types="node" />
// Writes a content repo's site shell into its www/: index.html, rendered from the templates in
// cml/, and the files in www/ beside this script (service worker, its loader). Run in the content
// repo, as its `npm run gen`:
//
//   bun ../arrmatura-books/scripts/gen.ts
//
// Everything comes from that repo: `window.R.app`, the theme and the store link from its
// package.json; owner and repo from its git remote `origin`. The page reads the docs from jsDelivr
// at the tag of package.json `version` (jsDelivr resolves `1.2.3` to a tag `v1.2.3` too), and the
// UI from the content repo's own bundle, www/dist (`npm run build`).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyTemplate } from "arrmatura";
import { htmlStringify, join, stringifyJson } from "ultimus";

type Source = { owner: string; repo: string; ref: string; scope: string };

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.cwd();
const WWW = path.join(ROOT, "www");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A file of the content repo at a ref, as jsDelivr serves it. */
const docUrl = ({ owner, repo, ref }: Source, file: string) =>
  `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${file}`;

/** `window.R.app`, from the content repo's package.json. */
function appResources(pkg: any) {
  return {
    id: pkg.name,
    name: pkg.displayName ?? pkg.name,
    logo: "/favicon.svg",
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    keywords: pkg.keywords ?? [],
    email: pkg.email,
    copyright: pkg.copyright,
  };
}

/** The page's DaisyUI theme and browser colour: `theme` / `themeColor` of the content repo's package.json. */
const themeResources = (pkg: any) => ({
  name: pkg.theme ?? "corporate",
  color: pkg.themeColor ?? "#1060c8",
});

/** `window.R`: the app block, the book's two jsDelivr endpoints at the release, and the
 * book store link (package.json `store`) when there is one. */
function bootstrap(source: Source, app: object, store?: unknown) {
  const { owner, repo, ref, scope } = source;
  return {
    app,
    book: {
      indexUrl: `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${ref}?structure=tree`,
      docUrl: docUrl(source, `${scope}/*`),
      scope,
      ...(store ? { store } : {}),
    },
  };
}

/** `<owner>/<repo>` of the content repo's GitHub remote `origin`. */
function gitHubRepo() {
  const url = git(ROOT, "remote", "get-url", "origin");
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`origin ${url} is not a GitHub repo`);
  return { owner: match[1], repo: match[2] };
}

/** The `json` pipe: a value as a JSON literal, indented to sit inside the script. */
const json = (x: unknown) => stringifyJson(x).replaceAll("\n", "\n        ");

function main() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const source = { ...gitHubRepo(), ref: pkg.version, scope: "docs" };
  const app = appResources(pkg);
  const cml = (file: string) => fs.readFileSync(path.join(HERE, "cml", file), "utf8");

  const config = {
    app,
    theme: themeResources(pkg),
    bootstrap: bootstrap(source, app, pkg.store),
    functions: { join, json },
    components: ["html.xml", "head.xml", "seo.xml", "index.xml"].map(cml),
  };
  const root = applyTemplate(`<Index/>`, config);

  fs.mkdirSync(WWW, { recursive: true });
  fs.writeFileSync(path.join(WWW, "index.html"), `<!DOCTYPE html>\n${htmlStringify(root.nodes[0])}\n`);
  for (const file of fs.readdirSync(path.join(HERE, "www"))) {
    fs.copyFileSync(path.join(HERE, "www", file), path.join(WWW, file));
  }
  console.log(`✅ www/ ← ${source.owner}/${source.repo}@${source.ref}`);
}

try {
  main();
} catch (err: any) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
