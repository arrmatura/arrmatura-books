// import { arrmaturaTemplatePlugin } from "./arrmaturaTemplatePlugin";
import type { BuildOptions } from "esbuild";

export function getEsbuildOptions({
  entryPoints = ["src/index.ts"],
  outdir = "./www/dist",
  plugins = [],
  loader = {},
  ...options
}: Partial<BuildOptions> = {}): BuildOptions {
  return {
    entryPoints,
    bundle: true,
    outdir,
    platform: "browser",
    format: "esm",
    // "external" emits the .map file but omits the `//# sourceMappingURL=` comment, so a
    // deployed bundle carries no pointer to its sourcemap. serve.ts opts dev builds back
    // into "linked" so devtools resolve original sources automatically.
    sourcemap: "external",
    target: "esnext",
    minify: true,
    keepNames: true,
    plugins: [...plugins], //arrmaturaTemplatePlugin,
    loader: {
      ".xml": "text",
      ".md": "text",
      ".png": "file",
      ".svg": "file",
      ...loader,
    },
    ...options,
  };
}
