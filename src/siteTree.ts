/** One index entry: GitHub's git-tree shape (`blob` / `tree` / `commit`) or the static `file` / `dir`. */
export interface SiteTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit" | "file" | "dir";
}

export interface SiteTreeResponse {
  tree: SiteTreeEntry[];
  truncated?: boolean;
}

const isDirEntry = (entry: SiteTreeEntry) =>
  entry.type === "tree" || entry.type === "dir";

export interface TreeNode {
  id: string;
  name: string;
  type: "dir" | "file";
  path: string;
  nodes?: TreeNode[];
  /** Directories only: id of the `index.md` this folder stands for, hoisted out of `nodes`. */
  doc?: string;
}

const INDEX_FILE = "index.md";

/**
 * Lifts a directory's own `index.md` onto the directory node as `doc` and drops it
 * from the children, so the tree shows one clickable folder instead of a folder
 * plus a redundant leaf. A root-level `index.md` has no folder to hang on and is
 * left as a normal leaf.
 */
function hoistIndexDoc(dir: TreeNode) {
  if (!dir.nodes) return;
  const index = dir.nodes.find(
    (node) => node.type === "file" && node.path.split("/").pop() === INDEX_FILE,
  );
  if (index) {
    dir.doc = index.id;
    dir.nodes = dir.nodes.filter((node) => node !== index);
  }
  dir.nodes.forEach(hoistIndexDoc);
}

/**
 * Ids of every directory containing `docId` — the nodes a tree has to have open for
 * that document to be reachable. Node ids are paths, so the ancestors are the path
 * prefixes at each `/` boundary; a root-level document has none.
 */
export function ancestorDirIds(docId: string): Record<string, boolean> {
  const dirs = (docId ?? "").split("/").slice(0, -1);
  return Object.fromEntries(
    dirs.map((_, i) => [dirs.slice(0, i + 1).join("/"), true]),
  );
}

/** The document a node opens: a file's own id, or a directory's hoisted `index.md`. */
export function docIdOf(node: TreeNode): string | undefined {
  return node.type === "dir" ? node.doc : node.id;
}

export function prettifyName(path: string): string {
  const tail = path.split("/").pop() ?? path;
  const base = tail.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/^\d+[-_.]?/, "").replaceAll(/[_]/g, " ");
  if (!cleaned) return base;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function buildTree(entries: SiteTreeEntry[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) =>
    ((isDirEntry(a) ? "0" : "1") + a.path).localeCompare(
      (isDirEntry(b) ? "0" : "1") + b.path,
    ),
  );

  for (const entry of sorted) {
    if (entry.type === "commit") continue;

    const tail = entry.path.split("/").pop() ?? entry.path;
    if (tail === "CLAUDE.md") continue;
    if (tail === "INDEX.md") continue;
    if (tail[0] === "_") continue;

    const isDir = isDirEntry(entry);
    const node: TreeNode = {
      id: entry.path,
      name: prettifyName(entry.path),
      type: isDir ? "dir" : "file",
      path: entry.path,
      ...(isDir ? { nodes: [] } : {}),
    };
    nodeMap.set(entry.path, node);

    const slashIdx = entry.path.lastIndexOf("/");
    if (slashIdx === -1) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.path.slice(0, slashIdx));
      if (parent?.nodes) parent.nodes.push(node);
      else roots.push(node);
    }
  }
  roots.forEach(hoistIndexDoc);
  return roots;
}

export function scopeSiteTree(
  data: SiteTreeResponse,
  scope: string,
): TreeNode[] {
  if (data.truncated) console.warn("Site tree truncated — index incomplete");
  const scoped = (data.tree ?? [])
    .filter((e) => e.path.startsWith(scope))
    .map((e) => ({ ...e, path: e.path.slice(scope.length) }));
  return buildTree(scoped);
}
