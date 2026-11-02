import { components as markdownComponents } from "arrmatura-markdown";
import { launchPlatformApp } from "arrmatura-web";
import { components as devopsComponents } from "proton/devops";
import * as registry from "./registry";
import { glossaryDefinition } from "./src/glossary";

export { launchPlatformApp } from "arrmatura-web";
export {
  buildTree,
  prettifyName,
  type SiteTreeEntry,
  type SiteTreeResponse,
  scopeSiteTree,
  type TreeNode,
} from "./src/siteTree";

export function launchBook({ components: customComponents = {}, ...resources }: any = {}) {
  const components = [...markdownComponents, ...devopsComponents, ...Object.values(registry), customComponents];

  launchPlatformApp({ components, resources, functions: { glossaryDefinition } });
}

const win = window as unknown as { launchBook: unknown; autoLoad: boolean };

win.launchBook = launchBook;

if (win.autoLoad) {
  launchBook();
}
