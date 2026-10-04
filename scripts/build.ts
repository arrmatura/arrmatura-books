import * as esbuild from "esbuild";
import { getEsbuildOptions } from "./getEsbuildOptions";
import { readFileJsonContent } from "./utils/files";

export async function main() {
  // The package.json `esbuild` block supplies the WHOLE option set — `format`, `outExtension`,
  // `packages`, anything esbuild accepts — not just entry points. Libraries emitting CJS for
  // their `require` condition need that; apps still get the browser/ESM defaults by naming
  // only `entryPoints` and `outdir`. An explicit argument outranks the file.
  const { esbuild: packageOptions = {} } = readFileJsonContent([`${process.cwd()}/package.json`]) ?? {};

  const buildOptions = getEsbuildOptions({ ...packageOptions });

  // `--watch` keeps the process alive and rebuilds on change. Apps that run a library's dev
  // build alongside their own (firebasis under the emulators) depend on it.
  if (process.argv.includes("--watch")) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("👀 watching…");
    return;
  }

  await esbuild.build(buildOptions);
}

main().catch((err: any) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
