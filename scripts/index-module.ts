import { indexModule } from "./reindex";

/**
 * Regenerates `registry.ts` at the package root. The package is one flat module — `cml/` and
 * `src/` beside `index.ts` — so the module dir is the root itself.
 */
indexModule({ moduleDir: "." });
