/**
 * The cover: generated, not drawn.
 *
 * An SVG built from package.json `book` with book/cover.png across the bottom,
 * rasterized by headless Chrome (raster.ts). Built rather than committed so the title,
 * subtitle and author printed on it cannot drift from the metadata pandoc sets inside
 * the book.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { COVER_COLORS, type CoverColors, ROOT, relativePosix, type Site, warn } from "./context";
import { rasterHash } from "./diagrams";
import { CHROME, RASTER_FORMAT, RASTER_SCALE, rasterizeSvg } from "./raster";

// A4 proportions in CSS pixels, doubled to 1240x1754 by RASTER_SCALE, which is 150dpi
// on A4. Not larger: the cover image is 1240px wide, exactly this width, and a wider
// cover would only upscale it. It sits flush with the bottom edge at its own aspect ratio, and
// the top of it fades into the page over COVER_FADE of its height.
export const COVER_WIDTH = 620;
export const COVER_HEIGHT = 877;
const COVER_FADE = 0.45;
const COVER_MARGIN = 70;

/** [width, height] from a PNG's IHDR, which is always the first chunk. */
export function pngSize(file: string): [number, number] {
  const header = fs.readFileSync(file).subarray(0, 24);
  if (header.subarray(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error(`${path.basename(file)} is not a PNG`);
  }
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

/**
 * A file as a data: URI, so the generated SVG is self-contained.
 *
 * Self-contained is what makes the cache correct: the digest that names the
 * rasterized cover is taken over the SVG's text, so with the photograph inside it a
 * replaced photograph changes the digest and the cover is re-rendered.
 */
function dataUri(file: string, mediaType: string): string {
  return `data:${mediaType};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** Greedy word wrap, like Python's textwrap.wrap: a word longer than the width is split. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      const room = current ? width - current.length - 1 : width;
      if (room > 0) {
        lines.push(current ? `${current} ${word.slice(0, room)}` : word.slice(0, room));
        word = word.slice(room);
      } else {
        lines.push(current);
      }
      current = "";
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** The three characters XML markup cannot carry as text. */
const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** One <text> element per line. SVG does no line breaking of its own. */
function textLines(markup: string[], lines: string[], x: number, y: number, leading: number, cssClass: string): number {
  lines.forEach((line, index) => {
    markup.push(`  <text class="${cssClass}" x="${x}" y="${y + index * leading}">${escapeXml(line)}</text>`);
  });
  return y + Math.max(lines.length - 1, 0) * leading;
}

/**
 * The cover as SVG markup: type block above, the photograph along the bottom.
 *
 * The photograph keeps its own aspect ratio at full cover width, so how much of the
 * page it covers follows from the image rather than from a number chosen here. Its
 * top fades to nothing against the page, which is why the page is dark: the
 * photograph is, and fading it into a light page would only muddy it.
 */
export function coverSvg(
  title: string,
  subtitle: string,
  author: string,
  photo: string,
  photoAspect: number,
  colors: CoverColors = COVER_COLORS,
): string {
  const photoHeight = Math.round(COVER_WIDTH / photoAspect);
  const photoTop = COVER_HEIGHT - photoHeight;
  const titleLines = wrap(title, 16);
  if (!titleLines.length) titleLines.push("");
  const subtitleLines = wrap(subtitle, 44);
  const markup = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" ` +
      `width="${COVER_WIDTH}" height="${COVER_HEIGHT}" role="img" aria-label="${escapeXml(title)}">`,
    "  <defs>",
    `    <linearGradient id="fade" x1="0" y1="${photoTop}" x2="0" ` +
      `y2="${photoTop + Math.round(photoHeight * COVER_FADE)}" gradientUnits="userSpaceOnUse">`,
    '      <stop offset="0" stop-color="#fff" stop-opacity="0"/>',
    '      <stop offset="1" stop-color="#fff" stop-opacity="1"/>',
    "    </linearGradient>",
    `    <mask id="fadeMask"><rect x="0" y="${photoTop}" width="${COVER_WIDTH}" ` +
      `height="${photoHeight}" fill="url(#fade)"/></mask>`,
    "    <style>",
    '      text { font-family: "Times New Roman", Georgia, serif; }',
    `      .title { font-size: 58px; fill: ${colors.ink}; }`,
    `      .subtitle { font-size: 19px; fill: ${colors.muted}; }`,
    `      .author { font-size: 16px; fill: ${colors.ink}; letter-spacing: 3px; text-transform: uppercase; }`,
    "    </style>",
    "  </defs>",
    `  <rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${colors.paper}"/>`,
    `  <image href="${photo}" x="0" y="${photoTop}" width="${COVER_WIDTH}" ` +
      `height="${photoHeight}" mask="url(#fadeMask)" preserveAspectRatio="xMidYMid slice"/>`,
    `  <rect x="${COVER_MARGIN}" y="168" width="84" height="3" fill="${colors.accent}"/>`,
  ];
  let last = textLines(markup, titleLines, COVER_MARGIN, 226, 66, "title");
  last = textLines(markup, subtitleLines, COVER_MARGIN, last + 74, 28, "subtitle");
  textLines(markup, [author.toUpperCase()], COVER_MARGIN, last + 66, 0, "author");
  markup.push("</svg>");
  return `${markup.join("\n")}\n`;
}

/**
 * Render the book's cover and return its path relative to ROOT, or null if it was not.
 *
 * Content-addressed, so the cover costs a render only when the metadata or the
 * photograph changes. The cover directory (build/cover) holds exactly one cover:
 * unlike a diagram, there is never a second one to serve, so a superseded
 * file is removed rather than left in the cache.
 */
export async function buildCover(site: Site): Promise<string | null> {
  if (!fs.existsSync(site.coverPhoto)) {
    warn(`  warning: ${relativePosix(ROOT, site.coverPhoto)} is missing; the book has no cover`);
    return null;
  }
  if (!fs.existsSync(CHROME)) {
    warn("  warning: Chrome is missing; the book has no cover");
    return null;
  }
  const covers = path.join(site.build, "cover");
  const [width, height] = pngSize(site.coverPhoto);
  const { title, subtitle = "", author = "" } = site.metadata;
  const photo = dataUri(site.coverPhoto, "image/png");
  const markup = coverSvg(title, subtitle, author, photo, width / height, site.coverColors);
  fs.mkdirSync(covers, { recursive: true });
  const destination = path.join(covers, `${rasterHash(`${RASTER_SCALE}\n${markup}`)}.${RASTER_FORMAT}`);
  if (!fs.existsSync(destination)) {
    const source = path.join(covers, "cover.svg");
    fs.writeFileSync(source, markup);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "book-cover-"));
    let written: boolean;
    try {
      written = await rasterizeSvg(source, destination, profile);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
      fs.rmSync(source, { force: true });
    }
    if (!written) return null;
    for (const stale of fs.readdirSync(covers)) {
      const file = path.join(covers, stale);
      if (stale.endsWith(`.${RASTER_FORMAT}`) && file !== destination) fs.unlinkSync(file);
    }
    console.log(`  cover rendered -> ${destination}`);
  }
  return relativePosix(ROOT, destination);
}
