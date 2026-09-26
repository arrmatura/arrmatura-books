import { WebClientService } from "arrmatura-web/core";
import {
  ancestorDirIds,
  docIdOf,
  type SiteTreeResponse,
  scopeSiteTree,
  type TreeNode,
} from "./siteTree";
import { classifyDocHref } from "./utils/resolveDocHref";

/**
 * Loads a book's site-tree index (`indexUrl`, scoped by `scope`) and answers questions
 * against it for the currently open document (`docId`): which folders to keep open, which
 * node a document id or a clicked link lands on.
 */
export class BookIndexTreeService extends WebClientService {
  loading = false;
  error = "";
  /** Id of the currently open document — the base relative links resolve against. */
  docId = "";
  /** Prefix of the site-tree paths this instance serves; stripped from the node ids. */
  scope = "";
  /** Top-level nodes of the scoped site tree. */
  nodes: TreeNode[] = [];

  set indexUrl(url: string) {
    if (!url) return;
    this.up({ loading: true, error: "" });
    this.fetchJson<SiteTreeResponse>(url)
      .then((data) => ({ nodes: scopeSiteTree(data, this.scope) }))
      .catch((err) => ({ error: String(err) }))
      .then((patch) => {
        this.up({ ...patch, loading: false });
      });
  }

  /**
   * Ids of the directories holding the current document, as `{ id: true }` — what a
   * tree consults to keep the path to the open document expanded, so that a document
   * reached from outside the tree (a deep link, a cross-document link, a reload) is
   * revealed rather than hidden inside collapsed folders. Recomputed on every `docId`
   * change, since `up()` clears the calculated-property cache.
   */
  getOpenPath(): Record<string, boolean> {
    return ancestorDirIds(this.docId);
  }

  /**
   * Follows a link clicked inside a rendered document (see `MDLink`).
   *
   * Cross-document `.md` links are resolved against the current document and
   * matched against the site tree, then followed in-app via the `doc` nav param.
   * Anything genuinely outside the app opens in a new tab; a link that stays
   * inside it never does, since that would only ever open a dead tab.
   */
  gotoLocalLink(href: string) {
    const link = classifyDocHref(href, this.docId);
    switch (link.kind) {
      case "ignore":
        return;
      case "route":
        window.location.href = link.hash;
        return;
      case "external":
        window.open(href);
        return;
      case "doc": {
        // Exact resolution first; fall back to the file name for docs whose
        // relative depth does not match where the file actually sits.
        const node =
          this.findNodeById(link.id) ?? this.findNodeByFileName(link.fileName);
        const docId = node && docIdOf(node);
        if (docId) window.location.href = `#/?doc=${docId}`;
        else console.warn(`No such document: ${href} (from ${this.docId})`);
      }
    }
  }

  /**
   * Finds the node that opens a document id (docs-root-relative path, extension
   * kept) — a file leaf, or the directory a hidden `index.md` was hoisted onto.
   */
  findNodeById(id: string, nodes = this.nodes): any {
    return this.findNode((node) => docIdOf(node) === id, nodes);
  }

  /** Finds a node by file name alone — ambiguous across directories, so a last resort. */
  findNodeByFileName(fileName: string, nodes = this.nodes): any {
    return this.findNode(
      (node) => docIdOf(node)?.split("/").at(-1) === fileName,
      nodes,
    );
  }

  findNode(match: (node: TreeNode) => boolean, nodes = this.nodes): any {
    for (const node of nodes || []) {
      if (match(node)) return node;

      if (node.nodes) {
        const found = this.findNode(match, node.nodes);
        if (found) return found;
      }
    }
    return null;
  }
}
