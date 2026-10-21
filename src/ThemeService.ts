import { WebClientService } from "arrmatura-web/core";

/** The reader's choice in localStorage: `dark` or `light`. A page shell may read the same key before first paint. */
const KEY = "theme";
const DARK = "dark";

/** The stored choice, else the OS colour scheme. */
const prefersDark = () => {
  const stored = localStorage.getItem(KEY);
  return stored ? stored === DARK : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/**
 * Light or dark reading mode. Dark puts `data-theme="dark"` on `<body>`; DaisyUI themes nest, so
 * it overrides the site's own light theme on `<html>`, which this service never needs to name.
 * The OS colour scheme decides until the reader toggles; the toggle is remembered.
 */
export class ThemeService extends WebClientService {
  __init() {
    this.up({ dark: prefersDark() });
  }

  get dark() {
    return document.body.dataset.theme === DARK;
  }

  set dark(dark: boolean) {
    if (dark) document.body.dataset.theme = DARK;
    else delete document.body.dataset.theme;
  }

  toggle() {
    localStorage.setItem(KEY, this.dark ? "light" : DARK);
    this.up({ dark: !this.dark });
  }
}
