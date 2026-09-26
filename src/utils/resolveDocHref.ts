/** Splits a path into meaningful segments, dropping empty and "." parts. */
const segments = (path: string): string[] =>
  path.split("/").filter((part) => part && part !== ".");

/**
 * Resolves a markdown link `href` against the document it appears in.
 *
 * Docs are authored to render on GitHub too, so hrefs are repo-relative:
 * `sibling.md`, `sub/child.md`, `../other-dir/doc.md`. A leading `/` means
 * docs-root-absolute. The result is a docs-root-relative id in the same shape
 * as the site-tree node ids — extension kept, no leading slash — so it can be
 * matched against `index.nodes` directly.
 *
 * `..` past the root is clamped rather than escaping it, mirroring how the
 * browser clamps a hash-routed document URL.
 *
 * @example resolveDocHref("../00-basics/01-glossary.md", "01-methodology/00-methodology.md")
 * // "00-basics/01-glossary.md"
 */
export const resolveDocHref = (href: string, fromDocId: string): string => {
  const base = href.startsWith("/") ? [] : segments(fromDocId).slice(0, -1);
  for (const part of segments(href)) {
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
};

/** What a link inside a rendered document points at. */
export type DocLink =
  /** Another document in this corpus — `id` is a site-tree id, `fileName` its last segment. */
  | { kind: "doc"; id: string; fileName: string }
  /** An in-app hash route such as `/#/?doc=_quotes` — `hash` is normalised to start with `#`. */
  | { kind: "route"; hash: string }
  /** Anything outside the app: another site, a raw asset, a `mailto:`. */
  | { kind: "external" }
  /** Nothing to navigate to — an empty href, or a same-document `#anchor`. */
  | { kind: "ignore" };

/**
 * Classifies a link clicked inside a rendered document, so the caller only has
 * to act on the outcome. `fromDocId` is the document the link appears in.
 *
 * Same-document `#anchor` links are deliberately ignored: the renderer emits no
 * heading ids to scroll to, and assigning a bare hash would clobber the app's
 * own hash route.
 */
export const classifyDocHref = (href: string, fromDocId: string): DocLink => {
  if (!href) return { kind: "ignore" };

  const hashAt = href.indexOf("#");
  // An in-app route ("#/…" or "/#/…") vs a same-document anchor ("#section").
  if (hashAt === 0 || (hashAt === 1 && href[0] === "/")) {
    return href[hashAt + 1] === "/"
      ? { kind: "route", hash: href.slice(hashAt) }
      : { kind: "ignore" };
  }

  const path = (hashAt === -1 ? href : href.slice(0, hashAt)).split("?")[0];
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//"))
    return { kind: "external" };

  const fileName = segments(path).at(-1) ?? "";
  if (!fileName) return { kind: "ignore" };
  if (!fileName.endsWith(".md")) return { kind: "external" };

  return { kind: "doc", id: resolveDocHref(path, fromDocId), fileName };
};
