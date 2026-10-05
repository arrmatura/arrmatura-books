import { WebClientService } from "arrmatura-web/core";
import { ancestorDirIds, docIdOf, type SiteTreeResponse, scopeSiteTree, type TreeNode } from "./siteTree";

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
   * Finds the node that opens a document id (docs-root-relative path, extension
   * kept) — a file leaf, or the directory a hidden `index.md` was hoisted onto.
   */
  findNodeById(id: string, nodes = this.nodes): any {
    return this.findNode((node) => docIdOf(node) === id, nodes);
  }

  /** Finds a node by file name alone — ambiguous across directories, so a last resort. */
  findNodeByFileName(fileName: string, nodes = this.nodes): any {
    return this.findNode((node) => docIdOf(node)?.split("/").at(-1) === fileName, nodes);
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
