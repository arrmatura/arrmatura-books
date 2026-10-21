/**
 * Mermaid diagrams, rasterized before pandoc sees them.
 *
 * Neither EPUB nor PDF can render a mermaid fence; pandoc prints it as a verbatim
 * code block. So the diagrams are rendered to PNG by mermaid-cli under npx — an
 * external renderer invoked the same way as pandoc and xelatex — and cached in
 * build/diagrams.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUILD, DIAGRAMS, ROOT, relativePosix, warn } from "./context";

// The version is pinned so a rebuild cannot silently change the diagrams' appearance.
// Scale 3 is legible in print without being heavy.
const MERMAID_CLI = "@mermaid-js/mermaid-cli@11.17.0";
const DIAGRAM_SCALE = 3;

const MERMAID_FENCE_RE = /^```[ \t]*mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;

/** The source of every mermaid block, in document order. */
export function extractMermaid(markdown: string): string[] {
  return [...markdown.matchAll(MERMAID_FENCE_RE)].map((match) => match[1]);
}

/**
 * The name of a rasterized image: a digest of the source it was rendered from.
 *
 * Content-addressing gives the cache for free — an unchanged source is already on
 * disk and is never re-rendered, and an edited one cannot be confused with its own
 * earlier version. Callers fold the render scale into what they hash, because
 * otherwise retuning a scale would serve every old PNG as a hit forever. Trailing
 * whitespace is normalized away so a cosmetic edit does not cost a render.
 */
export function rasterHash(source: string): string {
  const normalized = source
    .trim()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/** Where a diagram's PNG lives. Under build/, so it is a build artifact. */
function diagramPath(source: string): string {
  return path.join(DIAGRAMS, `${rasterHash(`${DIAGRAM_SCALE}\n${source}`)}.png`);
}

/**
 * Swap each mermaid block for its rendered image, positionally.
 *
 * A `null` image leaves that block as it was: a diagram that would not render stays
 * a code block, which is what the book prints today, so a renderer that is missing
 * or broken degrades the output instead of failing the build.
 */
export function replaceMermaid(markdown: string, images: (string | null)[]): string {
  const sources = extractMermaid(markdown);
  if (images.length !== sources.length) {
    throw new Error(`${sources.length} mermaid blocks but ${images.length} images`);
  }
  let index = 0;
  // Empty alt text: pandoc turns an image *with* alt text into a captioned,
  // floating figure, which would reorder the diagrams away from their prose.
  return markdown.replace(MERMAID_FENCE_RE, (whole) => {
    const image = images[index++];
    return image === null ? whole : `![](${image})`;
  });
}

/**
 * Render `jobs`, a list of [destination, source], in one mermaid-cli run.
 *
 * Given a markdown input, mermaid-cli renders every block it finds in a single
 * browser launch and numbers the output files by each block's *position in the
 * input* — not by the order the concurrent renders finish. That is what makes the
 * rename to <hash>.png safe, and it is why the diagrams are batched through a
 * scratch document rather than invoked one at a time.
 */
function runMermaidCli(jobs: [string, string][]): void {
  const scratch = path.join(BUILD, "diagrams-pending.md");
  const rendered = path.join(BUILD, "diagrams-rendered.md");
  const stem = "diagrams-rendered";
  // An interrupted earlier run can leave numbered PNGs behind, and this run's
  // numbering means something different. Clear them or one could be renamed to a
  // hash it is not a render of.
  for (const stale of fs.readdirSync(BUILD)) {
    if (stale.startsWith(`${stem}-`) && stale.endsWith(".png")) fs.unlinkSync(path.join(BUILD, stale));
  }
  fs.writeFileSync(scratch, `${jobs.map(([, source]) => `\`\`\`mermaid\n${source}\n\`\`\``).join("\n\n")}\n`);
  // biome-ignore format: each flag beside its value
  const args = [
    "-y", "-p", MERMAID_CLI, "mmdc",
    "-i", scratch, "-o", rendered,
    "-e", "png", "--scale", String(DIAGRAM_SCALE), "--backgroundColor", "white",
  ];
  try {
    const result = spawnSync("npx", args, { cwd: ROOT, encoding: "utf8" });
    if (result.error) {
      warn("  warning: npx is not installed, so diagrams stay as code blocks");
      return;
    }
    if (result.status !== 0) {
      warn(`  warning: mermaid-cli failed, so diagrams stay as code blocks\n${result.stderr.trim()}`);
      return;
    }
  } finally {
    fs.rmSync(scratch, { force: true });
    fs.rmSync(rendered, { force: true });
  }
  jobs.forEach(([destination], index) => {
    const produced = path.join(BUILD, `${stem}-${index + 1}.png`);
    if (fs.existsSync(produced)) fs.renameSync(produced, destination);
  });
}

/**
 * The PNG path of each source, or null where no PNG was produced.
 *
 * Only uncached diagrams are rendered, and identical diagrams share one render.
 * Paths come back relative to ROOT, which is on pandoc's resource path, alongside
 * the number of PNGs this run actually produced.
 */
function renderDiagrams(sources: string[]): { paths: (string | null)[]; rendered: number } {
  fs.mkdirSync(DIAGRAMS, { recursive: true });
  const pending = new Map<string, string>();
  for (const source of sources) {
    const destination = diagramPath(source);
    if (!fs.existsSync(destination) && !pending.has(destination)) pending.set(destination, source);
  }
  if (pending.size) runMermaidCli([...pending.entries()]);
  const paths = sources.map((source) => {
    const file = diagramPath(source);
    return fs.existsSync(file) ? relativePosix(ROOT, file) : null;
  });
  const rendered = [...pending.keys()].filter((file) => fs.existsSync(file)).length;
  return { paths, rendered };
}

/**
 * Replace every mermaid block with a rendered PNG.
 *
 * Returns the markdown, how many blocks became images, and how many of those cost a
 * render rather than a cache hit.
 */
export function resolveMermaid(markdown: string): { markdown: string; diagrams: number; rendered: number } {
  const sources = extractMermaid(markdown);
  if (!sources.length) return { markdown, diagrams: 0, rendered: 0 };
  const { paths, rendered } = renderDiagrams(sources);
  const unresolved = paths.filter((image) => image === null).length;
  if (unresolved) {
    warn(`  warning: ${unresolved} of ${sources.length} diagrams did not render and stay as code blocks`);
  }
  return { markdown: replaceMermaid(markdown, paths), diagrams: sources.length - unresolved, rendered };
}
