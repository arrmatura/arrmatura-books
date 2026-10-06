import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { writeFileContent } from "./utils/files";
import { mapDirectoryFiles } from "./utils/mapDirectoryFiles";

/** `../cml/Foo.xml` — a specifier relative to the generated file, always explicitly relative. */
const importSpecifier = (indexFile: string, sourceFile: string) => {
  const rel = posix.relative(posix.dirname(indexFile), sourceFile);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

/** Compiles a file-name glob (`*` only) into an anchored matcher over the basename. */
const globMatcher = (glob: string) => {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`);
};

/**
 * A `<Name>.demo.xml` gallery page sits beside the `<Name>.xml` it demos but ships in a different
 * kit, so it is excluded unless a `filter` asks for it by name.
 */
const isDemoFile = (fileName: string) => fileName.endsWith(".demo.xml");

/** One `.xml` source, plus the class implementing it when a `<Name>.ts` sits beside the file. */
type Source = {
  /** Identifier the import binds to — the basename with dots turned into underscores. */
  key: string;
  /** File name, used for ordering and for the duplicate check. */
  name: string;
  /** Import specifier of the `.xml`. */
  xml: string;
  /** Import specifier of the sibling `.ts`, when there is one. */
  service?: string;
  /**
   * True when the `.xml` holds nothing but the signature stub of `service` — one `<Component>`,
   * named after the file. Such a stub is never imported: the class registers under the very same
   * tag and the registry is last-write-wins, so the stub would be dead weight.
   */
  stubOnly?: boolean;
};

/** The ids a CML file registers — `<Component>` and `<Subcomponent>` alike. */
const componentIds = (file: string) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /<(?:Sub)?Component\s+id="([^"]+)"/g,
    ),
  ].map(([, id]) => id);

/**
 * Scans directories for `.xml` components, pairing each with its sibling `.ts` implementation.
 *
 * @param sourceDirs One or more directories to scan recursively. Several are needed when a kit's
 *   components are spread over sibling folders (`cml/`, `src/`, …) whose only common parent is the
 *   package root — scanning that root would sweep in `dist/` and other kits' CML.
 * @param indexFile Destination module. Import paths are computed relative to it, so the generated
 *   file may live anywhere: beside the sources, one level up, or in a separate `src/`.
 * @param filter File-name glob (`*` only), matched against the basename: `*.demo.xml` indexes the
 *   gallery pages and nothing else. Without it every `.xml` is indexed **except** `*.demo.xml` —
 *   the two sets are disjoint by default, so a demo page can never leak into a component index.
 */
function collectSources({
  sourceDirs,
  indexFile,
  filter,
}: {
  sourceDirs: string[];
  indexFile: string;
  filter?: string;
}): Source[] {
  const matches = filter ? globMatcher(filter) : null;
  const sources: Source[] = [];

  for (const sourceDir of sourceDirs) {
    mapDirectoryFiles(posix.resolve(sourceDir), (f, dir) => {
      const chunks = f.name.split(".");
      const ext = chunks.pop();
      if (ext !== "xml") return;
      if (matches ? !matches.test(f.name) : isDemoFile(f.name)) return;

      const base = chunks.join(".");
      const sourceFile = posix.join(sourceDir, dir, f.name);
      const serviceFile = `${posix.join(sourceDir, dir, base)}.ts`;
      const hasService = existsSync(serviceFile);
      sources.push({
        key: chunks.join("_"),
        name: f.name,
        xml: importSpecifier(indexFile, sourceFile),
        service: hasService
          ? importSpecifier(indexFile, `${sourceFile.slice(0, -4)}`)
          : undefined,
        stubOnly: hasService && componentIds(sourceFile).join() === base,
      });
    });
  }

  // One flat registry keyed by basename, so a name reused across source dirs would silently
  // shadow its twin. Fail loudly instead — the collision is a source bug, not an index bug.
  const seen = new Map<string, string>();
  for (const { key, xml } of sources) {
    const previous = seen.get(key);
    if (previous)
      throw new Error(
        `Duplicate CML component "${key}": ${previous} and ${xml}`,
      );
    seen.set(key, xml);
  }

  // Sorted by file name (not key), matching the order a single recursive scan produced.
  return sources.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generates a CML index module: one default import per `.xml` file, re-exported as a default array.
 *
 * Sibling `.ts` files are ignored — this is the form an app (`src/index.cml.ts`) and the gallery
 * (`src/index-cml.ts`) use, where services are registered separately. A kit-structured package
 * wants {@link indexModule} instead.
 */
export function indexCml(options: {
  sourceDirs: string[];
  indexFile: string;
  filter?: string;
}) {
  const sources = collectSources(options);

  writeFileContent(
    posix.resolve(options.indexFile),
    `
${sources.map(({ key, xml }) => `import ${key} from "${xml}"`).join(";\n")};

export default [
  ${sources.map(({ key }) => key).join(",\n  ")},
];
`,
  );

  console.log(
    `Reindex CML files: ${options.sourceDirs.join(", ")} -> ${options.indexFile} (${sources.length})`,
  );
}

/** Where a module keeps its sources — a flat module (`plugins/`) holds them at its own root. */
const MODULE_DIRS = ["cml", "src"];

/** Name of the generated file, in every module of a kit-structured package. */
export const REGISTRY_FILE = "registry.ts";

/**
 * Generates a module's `registry.ts`: one named re-export per component — every visual component
 * of the module, plus the real class of every service in it. No imports and no default export, so
 * the file is a pure re-export barrel; call sites register it as `Object.values(registry)`.
 *
 * A service is a `<Name>.xml` with a `<Name>.ts` beside it. The `.xml` is only a signature stub
 * (`<Signature>` metadata for the catalog, and an error message if the class never registers), so
 * the class is re-exported in its place. A stub declaring anything beyond its own tag is kept, and
 * exported as `$<Name>`.
 *
 * Export order is registration order, and it is load-bearing: `registerTypes` is last-write-wins
 * per tag. A module namespace lists its exports sorted by name (code-unit order), so the lines are
 * emitted in that same order — a bundler building the namespace in source order and native ESM
 * sorting it then agree. The `$` on a kept stub (0x24, below every identifier character) is what
 * keeps it ahead of the class overriding it.
 *
 * @param moduleDir Module root, relative to the package. Scanned dirs are `cml/` and `src/`, or the
 *   root itself when the module is flat.
 */
export function indexModule({ moduleDir }: { moduleDir: string }) {
  if (!existsSync(moduleDir)) throw new Error(`${moduleDir}: no such module`);

  const nested = MODULE_DIRS.map((d) => posix.join(moduleDir, d)).filter((d) =>
    existsSync(d),
  );
  const indexFile = posix.join(moduleDir, REGISTRY_FILE);
  const sources = collectSources({
    sourceDirs: nested.length ? nested : [moduleDir],
    indexFile,
  });

  const services = sources.filter((s) => s.service);
  // A stub-only `.xml` is dropped entirely — the class registers under the very same tag.
  const templates = sources.filter((s) => !s.stubOnly);
  const exports: [name: string, line: string][] = [
    ...templates.map(({ key, service, xml }): [string, string] => {
      const name = service ? `$${key}` : key;
      return [name, `export { default as ${name} } from "${xml}"`];
    }),
    ...services.map(({ key, service }): [string, string] => [
      key,
      `export { ${key} } from "${service}"`,
    ]),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  writeFileContent(
    posix.resolve(indexFile),
    `// GENERATED by \`npm run codegen\` — do not edit. Re-exports every component of this
// module: its CML, plus the class of each service, which takes the place of the signature stub
// standing in for it. Registered as \`Object.values(registry)\`; the \`index.ts\` beside it is
// where anything hand-written belongs.
${exports.map(([, line]) => line).join(";\n")};`,
  );

  console.log(
    `Reindex module: ${moduleDir} -> ${indexFile} (${templates.length} cml, ${services.length} services)`,
  );
}

// `bun reindex.ts <dirs> <indexFile> [--filter=<glob>]`, source dirs comma-separated:
//   bun reindex.ts "auth,cml,fields" ./index-cml.ts
//   bun reindex.ts "atomic/cml,cml" ./src/index-cml.ts --filter=*.demo.xml
// Guarded so the generators can also be imported — `index-modules.ts` calls `indexModule` once per
// module of a kit-structured package.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const filter = args
    .find((a) => a.startsWith("--filter="))
    ?.slice("--filter=".length);
  const [dirsArg, indexArg] = args.filter((a) => !a.startsWith("--"));
  const sourceDirs = (dirsArg || "./cml")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const indexFile = indexArg || "./src/index.cml.ts";

  indexCml({ sourceDirs, indexFile, filter });
}
