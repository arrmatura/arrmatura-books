import { components as markdownComponents } from "arrmatura-markdown";
import { launchPlatformApp } from "arrmatura-web";
import * as registry from "./registry";

export { launchPlatformApp } from "arrmatura-web";
export {
  buildTree,
  prettifyName,
  type SiteTreeEntry,
  type SiteTreeResponse,
  scopeSiteTree,
  type TreeNode,
} from "./src/siteTree";

export const components = [...markdownComponents, ...Object.values(registry)];

export function launchBook(resources = {}) {
  launchPlatformApp({ components, resources });
}

const win = window as unknown as { launchBook: unknown; autoLoad: boolean };

win.launchBook = launchBook;

if (win.autoLoad) {
  launchBook();
}
