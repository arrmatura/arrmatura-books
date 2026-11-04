/**
 * ```svg diagrams, rasterized before pandoc sees them.
 *
 * A site draws a ```svg fence live, with the markdown kit's components and its own
 * theme. Neither EPUB nor PDF can run that, and xelatex cannot embed SVG, so each
 * fence is drawn the same way in headless Chrome — the kit's real templates on
 * arrmatura-web's platform (diagram-page.ts), under the site's compiled stylesheet —
 * and screenshotted to PNG, cached in build/diagrams.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { getEsbuildOptions } from "../scripts/utils/getEsbuildOptions";
import { DIAGRAM_PAGE, DIAGRAMS, ROOT, relativePosix, SITE_CSS, warn } from "./context";
import { CHROME, dumpDom, screenshot } from "./raster";

// Scale 3 is legible in print without being heavy.
const DIAGRAM_SCALE = 3;

// Virtual time: Chrome runs the page's scripts and animation frames as fast as they
// go, for up to this much page time, before it dumps or shoots. Nothing on the page
// waits on a timer, so the budget is only a ceiling.
const RENDER_BUDGET = "--virtual-time-budget=10000";

// How many Chrome runs go at once. Each is a whole browser, so more would mostly contend.
const CONCURRENCY = 4;

const SVG_FENCE_RE = /^```[ \t]*svg[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;

/** The source of every ```svg block, in document order. */
export function extractDiagrams(markdown: string): string[] {
  return [...markdown.matchAll(SVG_FENCE_RE)].map((match) => match[1]);
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
 * Swap each ```svg block for its rendered image, positionally.
 *
 * A `null` image leaves that block as it was: a diagram that would not render stays
 * a code block, so a renderer that is missing or broken degrades the output instead
 * of failing the build.
 */
export function replaceDiagrams(markdown: string, images: (string | null)[]): string {
  const sources = extractDiagrams(markdown);
  if (images.length !== sources.length) {
    throw new Error(`${sources.length} svg blocks but ${images.length} images`);
  }
  let index = 0;
  // Empty alt text: pandoc turns an image *with* alt text into a captioned,
  // floating figure, which would reorder the diagrams away from their prose.
  return markdown.replace(SVG_FENCE_RE, (whole) => {
    const image = images[index++];
    return image === null ? whole : `![](${image})`;
  });
}

/**
 * The page that draws one diagram: the bundle, the site's stylesheet, the source as `R`.
 *
 * The figure is drawn at its natural width (`max-content`), flush with the top-left
 * corner (no margins), on white, so a window of the figure's own size frames exactly
 * it. No `data-theme`: the site's default theme.
 */
function diagramPage(source: string, bundle: string): string {
  // `<` escaped, so no source can close the <script> it sits in.
  const resources = JSON.stringify({ diagram: source }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(SITE_CSS).href}">
<style>html, body { margin: 0; background: #fff; } body { width: max-content; } body > * { margin: 0; }</style>
<script id="R" type="application/json">${resources}</script>
</head>
<body><script src="${pathToFileURL(bundle).href}"></script></body>
</html>
`;
}

/**
 * Draw one diagram page to `destination`. True if the PNG was written.
 *
 * Two Chrome runs, because a screenshot is the size of its window and the figure's
 * height is only known once drawn — the caption's line height and wrapping are the
 * site's. The first dumps the drawn page, on which diagram-page.ts left the size or
 * the source's problems; the second shoots at that size.
 */
async function rasterizeDiagram(page: string, destination: string, profile: string): Promise<boolean> {
  const url = pathToFileURL(page).href;
  const dom = (await dumpDom(url, profile, [RENDER_BUDGET])) ?? "";
  const error = /\bdata-error="([^"]*)"/.exec(dom)?.[1];
  if (error) {
    const lines = decodeURIComponent(error).replaceAll("\n", "\n    ");
    warn(`  warning: a diagram has errors, so it stays a code block\n    ${lines}`);
    return false;
  }
  const drawn = /\bdata-size="(\d+) (\d+)"/.exec(dom);
  if (!drawn) return false;
  const size: [number, number] = [Number(drawn[1]), Number(drawn[2])];
  return screenshot(url, destination, { size, scale: DIAGRAM_SCALE, profile, args: [RENDER_BUDGET] });
}

/** diagram-page.ts as one classic script, built as the site builds its own. Null if it would not bundle. */
async function bundleDiagramPage(outdir: string): Promise<string | null> {
  try {
    // A classic script: Chrome refuses a module script on a file: page.
    await esbuild.build(
      getEsbuildOptions({ entryPoints: { page: DIAGRAM_PAGE }, outdir, format: "iife", logLevel: "silent" }),
    );
    return path.join(outdir, "page.js");
  } catch (error) {
    warn(`  warning: the diagram page did not bundle, so diagrams stay as code blocks\n${(error as Error).message}`);
    return null;
  }
}

/**
 * Render `jobs`, a list of [destination, source], CONCURRENCY at a time.
 *
 * Everything but the PNGs lives in a scratch directory that is removed afterwards:
 * the bundle, a page per diagram, and a profile per diagram, since Chrome locks its
 * profile and parallel runs cannot share one.
 */
async function runChrome(jobs: [string, string][]): Promise<void> {
  if (!fs.existsSync(CHROME)) {
    warn("  warning: Chrome is missing, so diagrams stay as code blocks");
    return;
  }
  if (!fs.existsSync(SITE_CSS)) {
    const css = relativePosix(ROOT, SITE_CSS);
    warn(`  warning: ${css} is missing, so diagrams stay as code blocks; run the site's \`npm run build:css\``);
    return;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "book-diagrams-"));
  try {
    const bundle = await bundleDiagramPage(scratch);
    if (!bundle) return;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const index = next++;
        const [destination, source] = jobs[index];
        const page = path.join(scratch, `${index}.html`);
        fs.writeFileSync(page, diagramPage(source, bundle));
        await rasterizeDiagram(page, destination, path.join(scratch, `profile-${index}`));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The PNG path of each source, or null where no PNG was produced.
 *
 * Only uncached diagrams are rendered, and identical diagrams share one render.
 * Paths come back relative to ROOT, which is on pandoc's resource path, alongside
 * the number of PNGs this run actually produced.
 */
async function renderDiagrams(sources: string[]): Promise<{ paths: (string | null)[]; rendered: number }> {
  fs.mkdirSync(DIAGRAMS, { recursive: true });
  const pending = new Map<string, string>();
  for (const source of sources) {
    const destination = diagramPath(source);
    if (!fs.existsSync(destination) && !pending.has(destination)) pending.set(destination, source);
  }
  if (pending.size) await runChrome([...pending.entries()]);
  const paths = sources.map((source) => {
    const file = diagramPath(source);
    return fs.existsSync(file) ? relativePosix(ROOT, file) : null;
  });
  const rendered = [...pending.keys()].filter((file) => fs.existsSync(file)).length;
  return { paths, rendered };
}

/**
 * Replace every ```svg block with a rendered PNG.
 *
 * Returns the markdown, how many blocks became images, and how many of those cost a
 * render rather than a cache hit.
 */
export async function resolveDiagrams(
  markdown: string,
): Promise<{ markdown: string; diagrams: number; rendered: number }> {
  const sources = extractDiagrams(markdown);
  if (!sources.length) return { markdown, diagrams: 0, rendered: 0 };
  const { paths, rendered } = await renderDiagrams(sources);
  const unresolved = paths.filter((image) => image === null).length;
  if (unresolved) {
    warn(`  warning: ${unresolved} of ${sources.length} diagrams did not render and stay as code blocks`);
  }
  return { markdown: replaceDiagrams(markdown, paths), diagrams: sources.length - unresolved, rendered };
}
