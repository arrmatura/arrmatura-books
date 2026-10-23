/// <reference types="node" />
// Writes a content repo's site index, www/index.json, so the site reads its tree from its own
// host instead of jsDelivr. Run in the content repo, as its `npm run build:index`:
//
//   bun ../arrmatura-books/scripts/index-docs.ts [dir]
//
// The index lists the git-tracked files under `dir` (default `docs`), in the shape of a jsDelivr
// `?structure=tree` listing, so `BookIndexTreeService` reads it as-is with `scope` = `dir`.

import { execFileSync } from "node:child_process";
import type { SiteTreeEntry, SiteTreeResponse } from "../src/siteTree";
import { writeFileContent } from "./utils/files";

/** Folds `a/b/c.md` paths into nested directory entries. */
function treeOf(paths: string[]): SiteTreeResponse {
  const root: SiteTreeResponse = { files: [] };
  for (const path of paths) {
    const segments = path.split("/");
    const name = segments.pop() as string;
    let dir = root;
    for (const segment of segments) {
      let next = dir.files?.find((entry) => entry.type === "directory" && entry.name === segment);
      if (!next) {
        next = { type: "directory", name: segment, files: [] };
        dir.files?.push(next);
      }
      dir = next;
    }
    dir.files?.push({ type: "file", name } satisfies SiteTreeEntry);
  }
  return root;
}

function main() {
  const dir = process.argv[2] ?? "docs";
  const indexFile = "www/index.json";
  const paths = execFileSync("git", ["ls-files", "--", dir], { encoding: "utf8" }).split("\n").filter(Boolean);

  writeFileContent(indexFile, JSON.stringify(treeOf(paths)));
  console.log(`✅ Indexed ${paths.length} files of ${dir}/ -> ${indexFile}`);
}

main();
