/**
 * One node of a jsDelivr package listing fetched with `?structure=tree` — already a
 * tree, so `name` is a single path segment and a directory carries its children:
 * `https://data.jsdelivr.com/v1/packages/gh/<owner>/<repo>@<version>?structure=tree`
 */
export interface SiteTreeEntry {
  type: "file" | "directory";
  name: string;
  /** Directories only. */
  files?: SiteTreeEntry[];
}

export interface SiteTreeResponse {
  files?: SiteTreeEntry[];
}

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
 * Entries the tree never shows: agent and generator bookkeeping, anything a `_` marks
 * as a draft, and the dotfiles jsDelivr lists alongside the content.
 */
const HIDDEN = new Set(["CLAUDE.md", "INDEX.md"]);
const isHidden = (name: string) => HIDDEN.has(name) || name[0] === "_" || name[0] === ".";

/** Directories first, then files, each alphabetical — jsDelivr returns neither ordered. */
const byKind = (a: SiteTreeEntry, b: SiteTreeEntry) =>
  (a.type === "directory" ? "0" : "1")
    .concat(a.name)
    .localeCompare((b.type === "directory" ? "0" : "1").concat(b.name));

/**
 * Lifts a directory's own `index.md` onto the directory node as `doc` and drops it
 * from the children, so the tree shows one clickable folder instead of a folder
 * plus a redundant leaf. A root-level `index.md` has no folder to hang on and is
 * left as a normal leaf.
 */
function hoistIndexDoc(dir: TreeNode) {
  const index = dir.nodes?.find((node) => node.type === "file" && node.path.split("/").pop() === INDEX_FILE);
  if (index) {
    dir.doc = index.id;
    dir.nodes = dir.nodes?.filter((node) => node !== index);
  }
}

/**
 * Ids of every directory containing `docId` — the nodes a tree has to have open for
 * that document to be reachable. Node ids are paths, so the ancestors are the path
 * prefixes at each `/` boundary; a root-level document has none.
 */
export function ancestorDirIds(docId: string): Record<string, boolean> {
  const dirs = (docId ?? "").split("/").slice(0, -1);
  return Object.fromEntries(dirs.map((_, i) => [dirs.slice(0, i + 1).join("/"), true]));
}

/** The document a node opens: a file's own id, or a directory's hoisted `index.md`. */
export function docIdOf(node: TreeNode): string | undefined {
  return node.type === "dir" ? node.doc : node.id;
}

export function prettifyName(path: string): string {
  const tail = path.split("/").pop() ?? path;
  const [base] = tail.split(".");
  const cleaned = base.replace(/^.\d*-/, "").replaceAll(/[_]/g, " ");
  if (!cleaned) return base;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Turns one level of the listing into tree nodes, recursing into the directories.
 * Node ids are paths built from `parentPath` down, so they stay relative to whatever
 * level the walk started at — the scope root, not the package root.
 */
export function buildTree(entries: SiteTreeEntry[], parentPath = ""): TreeNode[] {
  return (entries ?? [])
    .filter((entry) => !isHidden(entry.name))
    .sort(byKind)
    .map((entry) => {
      const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      const node: TreeNode = {
        id: path,
        name: prettifyName(entry.name),
        type: entry.type === "directory" ? "dir" : "file",
        path,
      };
      if (entry.type === "directory") {
        node.nodes = buildTree(entry.files ?? [], path);
        hoistIndexDoc(node);
      }
      return node;
    });
}

/**
 * Narrows the listing to one directory and builds the tree under it. `scope` is a
 * `/`-separated path from the package root (`"docs"`), and it is dropped from the
 * node ids rather than carried in them. An empty scope serves the whole package; a
 * scope naming no directory yields an empty tree.
 */
export function scopeSiteTree(data: SiteTreeResponse, scope: string): TreeNode[] {
  let files = data?.files ?? [];
  for (const segment of (scope ?? "").split("/").filter(Boolean)) {
    const dir = files.find((entry) => entry.type === "directory" && entry.name === segment);
    if (!dir) {
      console.warn(`Site tree: no "${scope}" directory in the index`);
      return [];
    }
    files = dir.files ?? [];
  }
  return buildTree(files);
}
