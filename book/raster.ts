/**
 * Rasterize an SVG with headless Chrome.
 *
 * The cover is the one image this builder rasterizes itself, and it uses headless
 * Chrome rather than a standalone rasterizer: Chrome is already on the machine, so
 * this costs no install, and it is the engine the cover was drawn against, with the
 * gradient mask and the system fonts it names already in hand. If it is missing the
 * book is built without a cover.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, warn } from "./context";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Scale 2 where the diagrams get 3: the cover is A4 at 620x877 CSS pixels, so 2 gives
// 1240x1754, which is 150dpi on A4 — the full width of the 1240px cover image.
//
// And JPEG where the diagrams are PNG. The cover is mostly photograph, which is close
// to incompressible, so lossless is the wrong bargain: it multiplies the size for no
// visible gain, and xelatex embeds JPEG without re-encoding it. A diagram is flat line
// art and stays PNG, where lossless is cheap. Chrome picks the format from the
// extension and accepts only '.jpg' — '.jpeg' is refused outright.
export const RASTER_SCALE = 2;
export const RASTER_FORMAT = "jpg";

// Two measured facts shape how Chrome is called. It takes a singleton lock on its
// user-data directory, so pointing it at the default profile while the browser is
// open blocks until the browser quits — a build that hangs rather than fails; hence a
// throwaway profile. And given its own profile it writes the screenshot in about two
// and a half seconds and then keeps running rather than exiting, so what is waited on
// is the file settling, not the process. The timeout is only a backstop.
const RASTER_TIMEOUT_MS = 60_000;
const RASTER_POLL_MS = 200;

/**
 * The pixel size an SVG should be screenshotted at.
 *
 * Chrome's window is the viewport it captures, so a wrong size crops the cover or
 * pads it with blank paper. A declared pixel width and height win; a relative one
 * says nothing about intrinsic size, so the viewBox answers instead.
 */
export function svgSize(markup: string): [number, number] {
  const root = /<svg\b([^>]*)>/i.exec(markup);
  if (!root) throw new Error("markup has no <svg> element");
  const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(root[1])?.[1] ?? "";
  const width = attribute("width").replace(/px$/, "");
  const height = attribute("height").replace(/px$/, "");
  if (/^\d+$/.test(width) && /^\d+$/.test(height)) return [Number(width), Number(height)];
  const box = attribute("viewBox").trim().split(/\s+/);
  if (box.length === 4) return [Math.round(Number(box[2])), Math.round(Number(box[3]))];
  throw new Error("svg declares neither a pixel size nor a viewBox");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `file` has been written and has stopped growing. True if it was.
 *
 * Chrome does not exit after taking its screenshot, so there is no exit code to
 * wait for: the file appearing, and then holding its size across two polls, is the
 * signal that it is complete rather than half-written.
 */
async function settled(file: string, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + RASTER_TIMEOUT_MS;
  let previous = -1;
  while (Date.now() < deadline) {
    await sleep(RASTER_POLL_MS);
    if (!fs.existsSync(file)) {
      if (child.exitCode !== null) return false; // chrome gave up before writing anything
      continue;
    }
    const { size } = fs.statSync(file);
    if (size && size === previous) return true;
    previous = size;
  }
  return false;
}

/**
 * Screenshot one SVG with headless Chrome. True if the image was written.
 *
 * `profile` is a throwaway user-data directory, and the screenshot lands on a
 * partial path that is renamed into place only once complete — see RASTER_TIMEOUT_MS
 * for why, and note that a half-written file left in the cache would otherwise be
 * served as a hit forever.
 */
export async function rasterizeSvg(svg: string, destination: string, profile: string): Promise<boolean> {
  if (!fs.existsSync(CHROME)) return false;
  let width: number;
  let height: number;
  try {
    [width, height] = svgSize(fs.readFileSync(svg, "utf8"));
  } catch (error) {
    warn(`  warning: cannot size ${path.basename(svg)}: ${(error as Error).message}`);
    return false;
  }
  // Chrome picks the format from the extension and refuses anything it does not
  // know, so the in-progress name keeps the real extension last rather than
  // appending .part to it.
  const extension = path.extname(destination);
  const partial = path.join(path.dirname(destination), `${path.basename(destination, extension)}.part${extension}`);
  fs.rmSync(partial, { force: true });
  const child = spawn(
    CHROME,
    // biome-ignore format: flags grouped by purpose
    [
      "--headless", "--disable-gpu", "--hide-scrollbars",
      "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${RASTER_SCALE}`,
      `--screenshot=${partial}`,
      pathToFileURL(svg).href,
    ],
    { stdio: "ignore", cwd: ROOT },
  );
  let written: boolean;
  try {
    written = await settled(partial, child);
  } finally {
    child.kill();
  }
  if (!written) {
    warn(`  warning: rasterizing ${path.basename(svg)} did not finish within ${RASTER_TIMEOUT_MS / 1000}s`);
    fs.rmSync(partial, { force: true });
    return false;
  }
  fs.renameSync(partial, destination);
  return true;
}
