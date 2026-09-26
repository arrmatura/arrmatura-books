import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ComponentPropertyDefinition,
  ComponentSignature,
} from "arrmatura";
import { xmlParse } from "ultimus";

const ROOT_DIR = path.resolve(".");
// `generate-catalog.ts [sourceDirs] [outFile]`, source dirs comma-separated and relative to cwd.
// Defaults keep the single-kit call sites (`cd ./atomic && generate-catalog.ts`) working unchanged.
const SOURCE_DIRS = (process.argv[2] || "cml")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => path.join(ROOT_DIR, d));
const OUTPUT_PATH = path.join(ROOT_DIR, process.argv[3] || "catalog.json");

// `<Component>` may sit at the root or inside a wrapper (`<Components>`, `<components>`), so collect by
// walking instead of special-casing the wrapper name. Does not descend into a component's own body.
function collectComponents(nodes: any[]): any[] {
  return (nodes ?? []).flatMap((node: any) =>
    node?.tag === "Component" && node.attrs?.id
      ? [node]
      : collectComponents(node?.nodes),
  );
}

/** Absolute paths of every catalogable `.xml` under one source dir, sorted for a stable diff. */
async function scan(dir: string) {
  // A module has `cml/`, `src/`, or both — so half of a symmetric dir list is legitimately absent.
  // The caller passes both halves for every module; missing ones are not an error.
  if (!existsSync(dir)) return [];
  // Recursive: components live in subfolders too (e.g. table/cml/TableCell.Date.xml).
  const files = await fs.readdir(dir, { recursive: true });
  // `_`-prefixed files (e.g. `_safelist.xml`) are internal, and `<Name>.demo.xml` gallery pages
  // sit beside the component they demo — neither is a catalogued component.
  return files
    .filter(
      (f) =>
        f.endsWith(".xml") &&
        !f.endsWith(".demo.xml") &&
        !path.basename(f).startsWith("_"),
    )
    .sort()
    .map((f) => path.join(dir, f));
}

async function main() {
  console.log(`Scanning ${SOURCE_DIRS.join(", ")}...`);
  const xmlFiles = (await Promise.all(SOURCE_DIRS.map(scan))).flat();

  const catalog: ComponentSignature[] = [];
  // Several kits can declare the same id (an override); the first one scanned wins, matching
  // the order the dirs were passed in.
  const seen = new Set<string>();

  for (const filePath of xmlFiles) {
    const file = path.relative(ROOT_DIR, filePath);

    let componentNodes: any[];
    try {
      componentNodes = collectComponents(
        xmlParse(await fs.readFile(filePath, "utf-8")),
      );
    } catch (e) {
      console.error(`Failed to read or parse ${file}:`, e);
      continue;
    }
    // A file yielding nothing is how the earlier wrapper-case and recursion bugs stayed invisible.
    if (componentNodes.length === 0) {
      console.warn(`No components found in ${file}`);
    }

    componentNodes.forEach((componentNode: any) => {
      const id = componentNode.attrs?.id;
      if (seen.has(id)) return;
      seen.add(id);
      const signatureNode = componentNode.nodes?.find(
        (n: any) => n.tag === "Signature",
      );
      if (signatureNode) {
        const signature: ComponentSignature = {
          id,
          // Only services carry it, so leave it off UI components rather than defaulting it in.
          ...(signatureNode.attrs?.kind
            ? { kind: signatureNode.attrs.kind }
            : {}),
          description: signatureNode.attrs?.description ?? id,
          purpose: signatureNode.attrs?.purpose,
          name: signatureNode.attrs?.name ?? id,
          group: signatureNode.attrs?.group,
          properties: [],
          events: [],
          slots: [],
        };

        signatureNode.nodes?.forEach((n: any) => {
          if (n.tag === "Prop") {
            const prop: ComponentPropertyDefinition = {
              ...n.attrs,
              name: n.attrs?.name ?? n.attrs?.id,
              type: (n.attrs?.type as any) || "any",
              required:
                n.attrs?.required === true || n.attrs?.required === "true",
              description: n.attrs?.description as string,
              default: n.attrs?.default,
              enum: n.attrs?.enum
                ? (n.attrs.enum as string).split(",")
                : undefined,
            };
            signature.properties.push(prop);
          }
          // Future: handle Event, Slot
        });

        catalog.push(signature);
      } else {
        // Basic entry
        catalog.push({
          id,
          properties: [],
        });
      }
    });
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `Generated catalog with ${catalog.length} components at ${OUTPUT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
