/**
 * The browser side of a diagram's rasterization: bundled by diagrams.ts, run by headless Chrome.
 *
 * The page carries one ```svg fence as its `R.diagram` resource and the site's compiled
 * stylesheet, and this draws it with the markdown kit's own `MDCode.Svg` on arrmatura-web's
 * platform, so the PNG is the diagram the site shows rather than a re-implementation of it.
 * It then reports on the page's root element, for --dump-dom to carry back: `data-error`
 * when the source has problems, else `data-size`, the figure's size in CSS pixels.
 */

import { components, layoutDiagram } from "arrmatura-markdown";
import { launchWebApp } from "arrmatura-web/core";
import { xmlParse } from "ultimus";

const root = document.documentElement;

/** The problems SvgDiagramService would list under the drawing: the book prints none of them. */
function problems(source: string): string {
  try {
    return layoutDiagram(xmlParse(source)).errors.join("\n");
  } catch (error) {
    return `The diagram does not parse: ${(error as Error).message}`;
  }
}

/** The figure's size once the platform has painted it, which happens on an animation frame. */
function reportSize(): void {
  const figure = document.querySelector("figure");
  if (!figure) {
    requestAnimationFrame(reportSize);
    return;
  }
  const { width, height } = figure.getBoundingClientRect();
  root.dataset.size = `${Math.ceil(width)} ${Math.ceil(height)}`;
}

const { diagram = "" } = JSON.parse(document.getElementById("R")?.textContent ?? "{}");
const error = problems(diagram);
if (error) {
  root.dataset.error = encodeURIComponent(error);
} else {
  launchWebApp({ components, template: `<MDCode.Svg text="{R.diagram}" />` });
  requestAnimationFrame(reportSize);
}
