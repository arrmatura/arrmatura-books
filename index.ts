/**
 * The docs-site kit: the `App` shell, its components and services, and the `cml/extensions/`
 * overrides of `arrmatura-web/md`'s components, all scoped to the `Book` prefix `App` renders with
 * (`MDDocument.Book`, `MDLink.Book`, `MDSection.Book`, `MDCheckbox.Book`).
 */
import * as registry from "./registry";

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
 * Every component of the kit, ready to hand to `launchPlatformApp({ components })`.
 *
 * Pass this, not the module namespace: the registry walks an array, registering each CML string
 * by the `<Component id>` inside it, while a plain object is read as `{ tag: template }` — which
 * would register each file's whole source under its export name instead.
 */
export const components = Object.values(registry);
