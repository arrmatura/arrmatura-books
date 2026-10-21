/// <reference types="node" />
// Serves a content repo's www/ and rebuilds its UI bundle on change. Run in the content repo,
// as its `npm run start:serve`:
//
//   bun ../arrmatura-books/site/serve.ts
//
// The bundle is package.json `esbuild.entryPoints`, written to www/dist. Port: `PORT`, default 8080.

import * as esbuild from "esbuild";
import { readFileJsonContent } from "../scripts/utils/files";
import { getEsbuildOptions } from "../scripts/utils/getEsbuildOptions";

async function main() {
  const { name, esbuild: packageOptions } = readFileJsonContent([`${process.cwd()}/package.json`]) ?? {};
  const servedir = "./www";
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);

  const ctx = await esbuild.context(
    getEsbuildOptions({
      entryPoints: packageOptions?.entryPoints,
      outdir: `${servedir}/dist`,
      // Dev only: link the map so devtools pick it up.
      sourcemap: "linked",
    }),
  );
  await ctx.watch();

  const { hosts, port: servePort } = await ctx.serve({
    servedir,
    port,
    host: "localhost",
    // Resolved against cwd, not servedir.
    fallback: `${servedir}/index.html`,
    onRequest: ({ method, path, status }) => console.log(`>> ${method}${path} - ${status}`),
  });
  console.log(`✅ Serving "${name}" at ${hosts.map((h) => `http://${h}:${servePort}`).join(" ")} from ${servedir}`);
}

main().catch((err: any) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
