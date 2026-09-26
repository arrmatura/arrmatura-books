/**
 * The docs-site kit: the `App` shell, its components and services, and the `cml/extensions/`
 * overrides of `arrmatura-markdown`'s components, all scoped to the `Book` prefix `App` renders
 * with (`MDDocument.Book`, `MDLink.Book`, `MDSection.Book`, `MDCheckbox.Book`).
 *
 * The markdown kit is re-exported, so a docs site needs this one import.
 */
import { components as markdownComponents } from "arrmatura-markdown";
import * as registry from "./registry";

export * from "arrmatura-markdown";
export * from "./registry";
export {
  buildTree,
  prettifyName,
  type SiteTreeEntry,
  type SiteTreeResponse,
  scopeSiteTree,
  type TreeNode,
} from "./src/siteTree";

/**
 * Every component a docs site needs: the markdown kit this builds on, then this kit's own —
 * ready to hand to `launchPlatformApp({ components })`.
 *
 * Pass this, not the module namespace: the registry walks an array, registering each CML string
 * by the `<Component id>` inside it, while a plain object is read as `{ tag: template }` — which
 * would register each file's whole source under its export name.
 *
 * This local declaration deliberately shadows the `components` coming through
 * `export * from "arrmatura-markdown"`, which carries the markdown half alone.
 */
export const components = [...markdownComponents, ...Object.values(registry)];
